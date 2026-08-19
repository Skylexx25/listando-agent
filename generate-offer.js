const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Price logic based on inquiry type
function estimatePrice(inquiry) {
  const text = inquiry.description.toLowerCase();
  const category = inquiry.category.toLowerCase();

  // Wedding
  if (category.includes('hochzeit') || text.includes('hochzeit')) {
    if (text.includes('ganztag') || text.includes('8 stunden') || text.includes('ganzen tag')) return 1800;
    if (text.includes('6 stunden') || text.includes('7 stunden')) return 1500;
    if (text.includes('4 stunden') || text.includes('5 stunden')) return 1200;
    if (text.includes('2 stunden') || text.includes('3 stunden')) return 800;
    if (text.includes('standesamt') || text.includes('1 stunde')) return 600;
    return 1200;
  }

  // Newborn / Baby
  if (text.includes('neugeboren') || text.includes('0-3 monate') || text.includes('neugeborenenshooting')) return 350;
  if (text.includes('baby') && text.includes('shooting')) return 350;

  // Pregnancy
  if (text.includes('schwangerschaft') || text.includes('babybauch')) return 280;

  // Family
  if (text.includes('familien') || text.includes('family')) {
    if (text.includes('studio')) return 350;
    return 280;
  }

  // Portrait / Bewerbung
  if (text.includes('bewerbung') || text.includes('portrait') || text.includes('bewerbungsfotos')) return 180;

  // Business / Firmenevent
  if (text.includes('business') || text.includes('firmen') || text.includes('corporate')) return 500;

  // Birthday / Event
  if (text.includes('geburtstag') || text.includes('event') || text.includes('feier')) {
    if (text.includes('4 stunden') || text.includes('5 stunden')) return 800;
    if (text.includes('2 stunden') || text.includes('3 stunden')) return 500;
    return 400;
  }

  // Communion / Baptism
  if (text.includes('kommunion') || text.includes('konfirmation') || text.includes('taufe')) return 450;

  // School prom
  if (text.includes('abiball') || text.includes('abschluss')) return 700;

  // Default
  return 500;
}

async function generateOfferText(inquiry) {
  const prompt = `Du bist Bünyamin Eskinova von Time Picture Photography aus Eberbach. Du schreibst ein Angebot auf der Plattform listando.de.

Kundenanfrage:
- Name: ${inquiry.customerName}
- Kategorie: ${inquiry.category}
- Ort: ${inquiry.location}
- Datum: ${inquiry.serviceDate}
- Anfrage: ${inquiry.description}

Schreibe einen professionellen, persönlichen Angebotstext auf Deutsch (max. 4 Sätze).
- Beginne mit einer persönlichen Begrüßung mit dem Vornamen
- Gehe kurz auf den spezifischen Auftrag ein
- Erwähne deine Erfahrung (seit 2015, über 500 Hochzeiten & Shootings)
- Schließe mit einer freundlichen Einladung zum Gespräch
- Kein "Im Angebot enthalten ist..." am Anfang
- Kein Preis nennen (steht separat im Formular)
- Kein Telefon / E-Mail nennen (Plattformregel)
- Authentisch & warm, nicht zu formal`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text.trim();
}

module.exports = { generateOfferText, estimatePrice };
