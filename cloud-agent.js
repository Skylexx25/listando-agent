require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { generateOfferText, estimatePrice } = require('./generate-offer');

const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { processed: [] };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function parseAgeHours(text) {
  if (!text) return 999;
  if (text.includes('Minute') || text.includes('minute')) return 0.1;
  if (text.includes('Stunde')) return parseInt(text) || 1;
  if (text.includes('Tag')) return (parseInt(text) || 1) * 24;
  if (text.includes('Monat') || text.includes('monat')) return 999;
  if (text.includes('Jahr') || text.includes('jahr')) return 9999;
  return 999;
}

async function getInquiriesWithAge(page) {
  await page.goto('https://app.listando.com/experte/moeglichkeiten', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const results = [];
    const buttons = Array.from(document.querySelectorAll('main button'));
    const detailBtns = buttons.filter(b => b.textContent.trim() === 'mehr Details');

    detailBtns.forEach((btn, idx) => {
      let el = btn;
      let age = '';
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

async function getInquiryDetails(page, inquiryId) {
  await page.goto(`https://app.listando.com/experte/moeglichkeiten/open/${inquiryId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const allText = Array.from(document.querySelectorAll('main *'))
      .filter(e => e.childElementCount === 0 && e.textContent.trim())
      .map(e => e.textContent.trim());

    let customerName = '', age = '', category = '', location = '', description = '', serviceDate = '';

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

async function submitOffer(page, inquiryId, offerText, price) {
  await page.goto(`https://app.listando.com/experte/moeglichkeiten/open/${inquiryId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: 'Angebot erstellen' }).first().click();
  await page.waitForTimeout(800);

  const checkboxes = await page.locator('dialog[open] input[type="checkbox"], dialog[open] [role="checkbox"]').all();
  for (const cb of checkboxes) {
    const checked = await cb.getAttribute('aria-checked') || await cb.isChecked().catch(() => false);
    if (checked === false || checked === 'false') await cb.click();
  }

  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await page.waitForTimeout(1000);

  const dialog = page.locator('dialog[open]').last();
  await dialog.locator('input[type="number"]').fill(String(price));

  await dialog.locator('[role="combobox"]').click();
  await page.waitForTimeout(500);
  await page.getByRole('option', { name: '>> Das Hier <<' }).click();
  await page.waitForTimeout(1000);

  await dialog.getByRole('button', { name: '14 Tage' }).click();

  const descBox = dialog.locator('textarea, [role="textbox"]').last();
  await descBox.click();
  await descBox.fill(offerText);

  await dialog.getByRole('button', { name: 'Bestätigen' }).click();
  await page.waitForTimeout(2000);

  console.log(`✅ Angebot gesendet — Anfrage ${inquiryId} | ${price}€`);
}

async function login(page) {
  const email = process.env.LISTANDO_EMAIL;
  const password = process.env.LISTANDO_PASSWORD;
  if (!email || !password) throw new Error('LISTANDO_EMAIL oder LISTANDO_PASSWORD fehlt');

  await page.goto('https://app.listando.com/login', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('🌐 Login-URL:', page.url());
  console.log('📄 Titel:', await page.title());

  const emailSelector = 'input[type="email"], input[name="email"], input[placeholder*="mail" i], input[autocomplete="email"]';

  try {
    await page.waitForSelector(emailSelector, { timeout: 30000, state: 'visible' });
  } catch {
    const html = await page.content();
    console.error('❌ Email-Feld nicht gefunden. Seiten-HTML (erste 1000 Zeichen):\n' + html.substring(0, 1000));
    // Fallback: jedes sichtbare Input-Feld
    await page.waitForSelector('input:not([type="hidden"])', { timeout: 15000, state: 'visible' });
    const inputs = await page.locator('input:not([type="hidden"])').all();
    console.log(`   ${inputs.length} Input-Felder gefunden`);
    if (inputs.length > 0) {
      await inputs[0].fill(email);
      if (inputs.length > 1) await inputs[1].fill(password);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
      const url = page.url();
      if (!url.includes('/experte')) throw new Error('Login fehlgeschlagen (Fallback) — URL: ' + url);
      console.log('✅ Eingeloggt (Fallback)');
      return;
    }
    throw new Error('Keine Input-Felder auf Login-Seite gefunden');
  }

  await page.locator(emailSelector).first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button[type="submit"], button:has-text("Einloggen"), button:has-text("Anmelden"), button:has-text("Login")').first().click();
  await page.waitForTimeout(5000);

  const url = page.url();
  if (!url.includes('/experte')) throw new Error('Login fehlgeschlagen — URL: ' + url);
  console.log('✅ Eingeloggt');
}

async function runAgent() {
  console.log(`\n🤖 Cloud-Agent gestartet — ${new Date().toLocaleString('de-DE')}`);

  if (!process.env.LISTANDO_EMAIL || !process.env.LISTANDO_PASSWORD) {
    console.error('❌ LISTANDO_EMAIL oder LISTANDO_PASSWORD fehlt in Env-Vars');
    return;
  }

  const state = loadState();

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ]
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    await login(page);

    const inquiriesWithAge = await getInquiriesWithAge(page);
    console.log(`📋 ${inquiriesWithAge.length} Anfragen gefunden`);

    const newInquiries = inquiriesWithAge.filter(i => parseAgeHours(i.age) < 24);
    console.log(`🆕 ${newInquiries.length} neue Anfragen (< 24h)`);

    if (newInquiries.length === 0) {
      global.lastStatus = 'no_new_inquiries';
      global.lastRun = new Date().toISOString();
      return;
    }

    const detailBtns = await page.locator('main button:has-text("mehr Details")').all();

    for (const inquiry of newInquiries) {
      const btn = detailBtns[inquiry.index];
      if (!btn) continue;

      await btn.click();
      await page.waitForTimeout(1000);

      const inquiryId = page.url().split('/').pop();
      if (!inquiryId || inquiryId === 'moeglichkeiten') {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        continue;
      }

      if (state.processed.includes(inquiryId)) {
        console.log(`   → ${inquiryId} bereits bearbeitet`);
        await page.goBack({ waitUntil: 'domcontentloaded' });
        continue;
      }

      const details = await getInquiryDetails(page, inquiryId);
      if (!details || !details.description) {
        console.log(`   → ${inquiryId} keine Beschreibung`);
        continue;
      }

      console.log(`   Kunde: ${details.customerName} | ${details.category} | ${details.location}`);

      const price = estimatePrice(details);
      const offerText = await generateOfferText(details);

      await submitOffer(page, inquiryId, offerText, price);

      state.processed.push(inquiryId);
      state.lastRun = new Date().toISOString();
      global.lastRun = state.lastRun;
      global.lastStatus = `offer_sent:${inquiryId}:${price}€`;
      saveState(state);

      await page.waitForTimeout(3000);
    }

    console.log('✅ Durchlauf abgeschlossen');

  } finally {
    await browser.close();
  }
}

module.exports = { runAgent };
