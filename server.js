require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { runAgent } = require('./cloud-agent');

const app = express();
const PORT = process.env.PORT || 3000;

let isRunning = false;

async function safeRun() {
  if (isRunning) {
    console.log('Agent läuft bereits, überspringe...');
    return;
  }
  isRunning = true;
  try {
    await runAgent();
  } catch (err) {
    console.error('❌ Agent-Fehler:', err.message);
    global.lastStatus = 'error:' + err.message;
  } finally {
    isRunning = false;
  }
}

// Health endpoint — hält Render-Service am Leben (UptimeRobot pingt alle 5 Min)
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    running: isRunning,
    lastRun: global.lastRun || null,
    lastStatus: global.lastStatus || null,
    nextRun: 'stündlich (Minute 0)',
  });
});

// Manueller Trigger vom Handy: https://deine-app.onrender.com/run
app.get('/run', async (req, res) => {
  res.json({ status: 'gestartet', time: new Date().toISOString() });
  safeRun();
});

app.listen(PORT, () => {
  console.log(`🌐 Server läuft auf Port ${PORT}`);
  // Einmal direkt beim Start durchlaufen
  safeRun();
});

// Stündlich um Minute 0
cron.schedule('0 * * * *', () => {
  console.log(`\n⏰ Cron: ${new Date().toLocaleString('de-DE')}`);
  safeRun();
});
