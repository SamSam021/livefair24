// admin-auth.js
//
// Minimal session-based auth for the admin panel. No dependencies: sessions
// are random tokens held in memory (lost on restart — you'll just need to
// log in again, which is fine for a single-operator admin panel) and sent
// as an httpOnly cookie.
//
// The admin password comes from ADMIN_PASSWORD in your environment. If you
// haven't set one, a random password is generated at startup and printed to
// the server log ONCE — set ADMIN_PASSWORD for real deployments instead of
// relying on that.

const crypto = require('crypto');

let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  adminPassword = crypto.randomBytes(9).toString('base64url');
  console.log('\n=================================================================');
  console.log('  No ADMIN_PASSWORD set — generated a temporary one for this run:');
  console.log(`  ${adminPassword}`);
  console.log('  Set ADMIN_PASSWORD in your environment before real deployment —');
  console.log('  this one changes every time the server restarts.');
  console.log('=================================================================\n');
}

const sessions = new Map(); // token -> expiry timestamp
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function createSession() {
  const token = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  sessions.delete(token);
}

function checkPassword(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  // Constant-time-ish comparison to avoid trivial timing attacks
  const a = Buffer.from(candidate);
  const b = Buffer.from(adminPassword);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

module.exports = { createSession, isValidSession, destroySession, checkPassword, parseCookies };
