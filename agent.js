require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { generateOfferText, estimatePrice } = require('./generate-offer');

const STATE_FILE = path.join(__dirname, 'state.json');
const CHROME_PROFILE = path.join(process.env.HOME, 'Library/Application Support/Google/Chrome/Default');

// Load state (processed inquiry IDs)
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { processed: [] };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Parse "vor X Stunden/Minuten/Tagen" into hours
function parseAgeHours(text) {
  if (!text) return 999;
  if (text.includes('Minute') || text.includes('minute')) return 0.1;
  if (text.includes('Stunde')) {
    const n = parseInt(text) || 1;
    return n;
  }
  if (text.includes('Tag')) {
    const n = parseInt(text) || 1;
    return n * 24;
  }
  if (text.includes('Monat') || text.includes('monat')) return 999;
  if (text.includes('Jahr') || text.includes('jahr')) return 9999;
  return 999;
}

async function connectBrowser() {
  // Try existing Chrome via CDP first (Chrome must be started with --remote-debugging-port=9222)
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222', { timeout: 3000 });
    console.log('Verbunden mit laufendem Chrome via CDP');
    return { browser, mode: 'cdp' };
  } catch {
    console.log('Kein CDP-Chrome gefunden — starte eigenen Chromium mit Profil-Kopie...');
  }

  // Launch Playwright Chromium with a copied profile (safe when Chrome is open)
  const tmpProfile = path.join(require('os').tmpdir(), 'listando-playwright-profile');
  if (!fs.existsSync(tmpProfile)) {
    fs.mkdirSync(tmpProfile, { recursive: true });
    // Copy only Cookies + Local Storage from Chrome profile
    const cookiesDb = path.join(CHROME_PROFILE, 'Cookies');
    const lsDir = path.join(CHROME_PROFILE, 'Local Storage');
    if (fs.existsSync(cookiesDb)) fs.copyFileSync(cookiesDb, path.join(tmpProfile, 'Cookies'));
    if (fs.existsSync(lsDir)) fs.cpSync(lsDir, path.join(tmpProfile, 'Local Storage'), { recursive: true });
  }

  const browser = await chromium.launchPersistentContext(tmpProfile, {
    headless: false,
    args: ['--no-sandbox']
  });
  return { browser, mode: 'persistent' };
}

async function readInquiries(page) {
  await page.goto('https://app.listando.com/experte/moeglichkeiten', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Extract all inquiry cards from the page
  const inquiries = await page.evaluate(() => {
    const results = [];
    const main = document.querySelector('main');
    if (!main) return results;

    // Each inquiry is a group of generics with a "mehr Details" button
    const buttons = Array.from(main.querySelectorAll('button'));
    const detailButtons = buttons.filter(b => b.textContent.trim() === 'mehr Details');

    detailButtons.forEach(btn => {
      // Walk up to find the card container, then get sibling text nodes
      const container = btn.closest('[class]') || btn.parentElement;
      const allText = [];
      let el = container;
      // Go up two levels to get the card
      if (el && el.parentElement) el = el.parentElement;
      if (el && el.parentElement) el = el.parentElement;

      const textEls = el ? Array.from(el.querySelectorAll('*')).filter(e =>
        e.childElementCount === 0 && e.textContent.trim()
      ) : [];

      textEls.forEach(t => allText.push(t.textContent.trim()));

      // Try to extract the inquiry URL from the button's click handler
      const onclickAttr = btn.getAttribute('onclick') || '';
      results.push({ texts: allText, button: btn.outerHTML.slice(0, 100) });
    });

    return results;
  });

  // Better approach: read the accessibility tree data from page
  const pageData = await page.evaluate(() => {
    const items = [];
    const generics = Array.from(document.querySelectorAll('main > *'));

    // Find all "mehr Details" buttons and their surrounding context
    const allElements = Array.from(document.querySelectorAll('main *'));
    let current = {};
    let collecting = false;

    allElements.forEach(el => {
      const text = el.textContent.trim();
      const tag = el.tagName;

      if (el.tagName === 'BUTTON' && text === 'mehr Details') {
        if (current.description) {
          items.push({ ...current });
        }
        current = {};
        collecting = true;
        return;
      }

      if (!collecting || el.childElementCount > 0) return;

      if (!current.category && /Fotograf|Hochzeit|Kameraman|Videograf/i.test(text)) {
        current.category = text;
      } else if (!current.customerName && /^[A-ZÄÖÜ][a-zäöüß]/.test(text) && text.length < 40 && !text.includes('suche')) {
        current.customerName = text;
      } else if (!current.location && text.length < 50 && !/vor \d/.test(text) && !text.includes('suche')) {
        current.location = text;
      } else if (!current.age && /vor \d/.test(text)) {
        current.age = text;
      } else if (!current.description && text.length > 30) {
        current.description = text;
      }
    });

    return items;
  });

  return pageData;
}

async function getInquiryDetails(page, inquiryId) {
  await page.goto(`https://app.listando.com/experte/moeglichkeiten/open/${inquiryId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;

    const allText = Array.from(main.querySelectorAll('*'))
      .filter(e => e.childElementCount === 0 && e.textContent.trim())
      .map(e => e.textContent.trim());

    // Find age, customer name, category, location, description
    let customerName = '', age = '', category = '', location = '', description = '';
    let serviceDate = '';

    for (const t of allText) {
      if (!age && /vor \d+/.test(t)) age = t;
      if (!category && /Fotograf|Hochzeit|Videograf/i.test(t) && t.length < 30) category = t;
      if (!customerName && /^[A-ZÄÖÜ]/.test(t) && t.length < 30 && !t.includes('suche') && !category.includes(t)) {
        customerName = t;
      }
      if (!location && t.length < 50 && !/vor \d/.test(t) && !/suche|foto|Foto/i.test(t) && customerName && category) {
        location = t;
      }
      if (t.length > 60 && !description) description = t;
      if (/\d{2}\.\d{2}\.\d{4}/.test(t)) serviceDate = t.match(/\d{2}\.\d{2}\.\d{4}/)[0];
    }

    return { customerName, age, category, location, description, serviceDate };
  });
}

async function submitOffer(page, inquiryId, offerText, price, serviceDate) {
  await page.goto(`https://app.listando.com/experte/moeglichkeiten/open/${inquiryId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Click first "Angebot erstellen" button
  await page.getByRole('button', { name: 'Angebot erstellen' }).first().click();
  await page.waitForTimeout(800);

  // Check all 3 confirmation checkboxes
  const checkboxes = await page.locator('dialog[open] input[type="checkbox"], dialog[open] [role="checkbox"]').all();
  for (const cb of checkboxes) {
    const checked = await cb.getAttribute('aria-checked') || await cb.isChecked().catch(() => false);
    if (checked === false || checked === 'false') await cb.click();
  }

  // Click Bestätigen
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await page.waitForTimeout(1000);

  // Now the offer form dialog should be open
  const dialog = page.locator('dialog[open]').last();

  // Fill price
  await dialog.locator('input[type="number"]').fill(String(price));

  // Select template ">> Das Hier <<"
  await dialog.locator('[role="combobox"]').click();
  await page.waitForTimeout(500);
  await page.getByRole('option', { name: '>> Das Hier <<' }).click();
  await page.waitForTimeout(1000);

  // Select 14 Tage expiry
  await dialog.getByRole('button', { name: '14 Tage' }).click();

  // Fill description
  const descBox = dialog.locator('textarea, [role="textbox"]').last();
  await descBox.click();
  await descBox.fill(offerText);

  // Submit
  await dialog.getByRole('button', { name: 'Bestätigen' }).click();
  await page.waitForTimeout(2000);

  console.log(`✅ Angebot abgesendet für Anfrage ${inquiryId} | Preis: ${price}€`);
}

async function getAllInquiryIds(page) {
  await page.goto('https://app.listando.com/experte/moeglichkeiten', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Intercept navigation to extract IDs from "mehr Details" clicks
  // Instead: click each "mehr Details" and capture the URL
  const ids = await page.evaluate(() => {
    // Look for any data attributes or links that contain the inquiry ID
    const links = Array.from(document.querySelectorAll('a[href*="moeglichkeiten/open/"]'));
    if (links.length > 0) return links.map(l => l.href.split('/').pop());
    return [];
  });

  if (ids.length > 0) return ids;

  // Fallback: click buttons and collect URLs
  const detailBtns = await page.locator('main button:has-text("mehr Details")').all();
  const inquiryIds = [];

  for (let i = 0; i < Math.min(detailBtns.length, 5); i++) {
    // Only check first 5 (newest)
    await detailBtns[i].click();
    await page.waitForTimeout(800);
    const url = page.url();
    const id = url.split('/').pop();
    if (id && id !== 'moeglichkeiten') inquiryIds.push(id);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
  }

  return inquiryIds;
}

async function getInquiriesWithAge(page) {
  await page.goto('https://app.listando.com/experte/moeglichkeiten', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Extract age text next to each "mehr Details" button
  return await page.evaluate(() => {
    const results = [];
    const buttons = Array.from(document.querySelectorAll('main button'));
    const detailBtns = buttons.filter(b => b.textContent.trim() === 'mehr Details');

    detailBtns.forEach((btn, idx) => {
      // Look for age text near this button
      let el = btn;
      let age = '';
      // Search siblings and nearby elements
      for (let i = 0; i < 10; i++) {
        if (!el) break;
        const prev = el.previousElementSibling;
        if (prev && /vor \d/.test(prev.textContent)) { age = prev.textContent.trim(); break; }
        el = el.parentElement;
      }
      results.push({ index: idx, age });
    });

    return results;
  });
}

async function run() {
  console.log(`\n🤖 Listando Agent gestartet — ${new Date().toLocaleString('de-DE')}`);
  const state = loadState();

  const { browser, mode } = await connectBrowser();

  try {
    let page;
    if (mode === 'cdp') {
      const contexts = browser.contexts();
      const ctx = contexts[0] || await browser.newContext();
      page = await ctx.newPage();
    } else {
      page = await browser.newPage();
    }

    // Navigate to listando
    await page.goto('https://app.listando.com/experte/moeglichkeiten', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Check if logged in
    const url = page.url();
    if (!url.includes('app.listando.com')) {
      console.log('❌ Nicht eingeloggt. Bitte manuell in Chrome einloggen.');
      return;
    }

    // Get inquiries with their age
    const inquiriesWithAge = await getInquiriesWithAge(page);
    console.log(`📋 ${inquiriesWithAge.length} Anfragen gefunden`);

    // Filter: only < 24 hours old
    const newInquiries = inquiriesWithAge.filter(i => parseAgeHours(i.age) < 24);
    console.log(`🆕 ${newInquiries.length} neue Anfragen (< 24h)`);

    if (newInquiries.length === 0) {
      console.log('Keine neuen Anfragen. Nächster Check in 1 Stunde.');
      return;
    }

    // Get IDs for the new inquiries by clicking through
    const detailBtns = await page.locator('main button:has-text("mehr Details")').all();

    for (const inquiry of newInquiries) {
      const btn = detailBtns[inquiry.index * 2]; // two "mehr Details" per card
      if (!btn) continue;

      await btn.click();
      await page.waitForTimeout(1000);

      const inquiryId = page.url().split('/').pop();
      console.log(`\n📌 Anfrage ${inquiryId} (${inquiry.age})`);

      // Skip if already processed
      if (state.processed.includes(inquiryId)) {
        console.log('   → bereits bearbeitet, überspringe');
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        continue;
      }

      // Get full inquiry details
      const details = await getInquiryDetails(page, inquiryId);
      console.log(`   Kunde: ${details?.customerName || '?'} | Kategorie: ${details?.category || '?'} | Ort: ${details?.location || '?'}`);

      if (!details || !details.description) {
        console.log('   → keine Beschreibung gefunden, überspringe');
        continue;
      }

      // Generate offer
      const price = estimatePrice(details);
      const offerText = await generateOfferText(details);
      console.log(`   Preis: ${price}€`);
      console.log(`   Text: ${offerText.slice(0, 80)}...`);

      // Submit offer
      await submitOffer(page, inquiryId, offerText, price, details.serviceDate);

      // Mark as processed
      state.processed.push(inquiryId);
      state.lastRun = new Date().toISOString();
      saveState(state);

      // Wait between submissions
      await page.waitForTimeout(3000);
    }

    console.log('\n✅ Durchlauf abgeschlossen');

  } finally {
    if (mode === 'cdp') {
      // Don't close the user's Chrome
    } else {
      await browser.close();
    }
  }
}

run().catch(err => {
  console.error('❌ Fehler:', err.message);
  process.exit(1);
});
