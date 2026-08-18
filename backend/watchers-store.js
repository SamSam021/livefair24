// watchers-store.js
//
// Persists everyone who's signed up for a price-drop alert. Same pattern as
// config-store.js — backed by persistence.js, synchronous public API backed
// by an in-memory copy, call init() once at startup.

const crypto = require('crypto');
const persistence = require('./persistence');

let watchers = [];

async function init() {
  watchers = await persistence.loadState('watchers', []);
}

function persist() {
  persistence.saveState('watchers', watchers).catch((err) => {
    console.error('[watchers-store] Failed to persist:', err.message);
  });
}

module.exports = {
  init,

  create({ email, eventId, artist, venue, city, eventUrl, initialPrice }) {
    const watcher = {
      id: `w_${crypto.randomBytes(8).toString('hex')}`,
      unsubscribeToken: crypto.randomBytes(16).toString('hex'),
      email,
      eventId,
      artist,
      venue,
      city,
      eventUrl,
      initialPrice,
      lastKnownPrice: initialPrice,
      lastNotifiedPrice: null,
      createdAt: new Date().toISOString(),
      lastCheckedAt: null,
      active: true,
    };
    watchers.push(watcher);
    persist();
    return watcher;
  },

  getActive() {
    return watchers.filter((w) => w.active);
  },

  getById(id) {
    return watchers.find((w) => w.id === id);
  },

  updateAfterCheck(id, currentLowest) {
    const w = watchers.find((w) => w.id === id);
    if (!w) return;
    w.lastKnownPrice = currentLowest;
    w.lastCheckedAt = new Date().toISOString();
    persist();
  },

  markNotified(id, notifiedPrice) {
    const w = watchers.find((w) => w.id === id);
    if (!w) return;
    w.lastNotifiedPrice = notifiedPrice;
    persist();
  },

  unsubscribe(id, token) {
    const w = watchers.find((w) => w.id === id);
    if (!w) return { ok: false, error: 'Not found' };
    if (w.unsubscribeToken !== token) return { ok: false, error: 'Invalid token' };
    w.active = false;
    persist();
    return { ok: true };
  },

  getAll() {
    return watchers;
  },
};
