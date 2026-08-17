// routes/watchers.js
//
// Handlers for the public-facing "notify me if this drops" feature.

const watchersStore = require('../watchers-store');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createWatcher(body) {
  const { email, eventId, artist, venue, city, eventUrl, initialPrice } = body;
  if (!email || !EMAIL_RE.test(email)) {
    throw Object.assign(new Error('A valid email is required'), { statusCode: 400 });
  }
  if (eventId == null || !artist || !initialPrice) {
    throw Object.assign(new Error('eventId, artist, and initialPrice are required'), { statusCode: 400 });
  }
  const watcher = watchersStore.create({
    email,
    eventId,
    artist,
    venue: venue || '',
    city: city || '',
    eventUrl: eventUrl || '',
    initialPrice: Number(initialPrice),
  });
  return { ok: true, id: watcher.id };
}

function unsubscribe(id, token) {
  return watchersStore.unsubscribe(id, token);
}

module.exports = { createWatcher, unsubscribe };
