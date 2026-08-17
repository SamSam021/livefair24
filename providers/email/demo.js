// providers/email/demo.js
//
// Reference implementation of the EMAIL PROVIDER interface:
//   id, name, requiredEnv, isEnabled(env), send({to, subject, text, html}, env)
//     -> { success: bool, error?: string }
//
// This demo provider never sends a real email — it just records what
// WOULD have been sent, viewable from the admin panel, so you can test the
// whole price-alert flow before wiring up a real email API key.

const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', '..', 'data', 'demo-sent-emails.json');

function readLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeLog(entries) {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(entries.slice(-100), null, 2)); // keep last 100
}

module.exports = {
  id: 'demo',
  name: 'Demo (logs only, does not send real email)',
  requiredEnv: [],
  isEnabled() {
    return true;
  },
  async send(message) {
    console.log(`[demo email] to=${message.to} subject="${message.subject}"`);
    const entries = readLog();
    entries.push({ ...message, sentAt: new Date().toISOString(), demo: true });
    writeLog(entries);
    return { success: true, demo: true };
  },
  getSentLog() {
    return readLog();
  },
};
