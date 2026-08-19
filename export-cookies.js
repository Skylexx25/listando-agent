// Einmaliges Script — läuft auf deinem Mac
// Liest Listando-Cookies aus Chrome aus und gibt JSON aus
// Verwendung: node export-cookies.js

const ChromeCookies = require('chrome-cookies-secure');

console.log('Lese Chrome-Cookies für app.listando.com...\n');

ChromeCookies.getCookies('https://app.listando.com', 'playwright', (err, cookies) => {
  if (err) {
    console.error('Fehler:', err.message);
    console.log('\n→ Alternative: Manuell exportieren (siehe unten)');
    console.log('   1. Chrome öffnen, auf app.listando.com einloggen');
    console.log('   2. F12 → Application → Cookies → https://app.listando.com');
    console.log('   3. Alle Zeilen markieren, als JSON notieren');
    return;
  }

  if (!cookies || cookies.length === 0) {
    console.log('Keine Cookies gefunden. Chrome muss auf app.listando.com eingeloggt sein.');
    return;
  }

  const json = JSON.stringify(cookies);
  console.log('✅ Cookies gefunden!\n');
  console.log('━━━ Kopiere diesen Wert als LISTANDO_COOKIES in Render ━━━\n');
  console.log(json);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`${cookies.length} Cookies exportiert.`);
});
