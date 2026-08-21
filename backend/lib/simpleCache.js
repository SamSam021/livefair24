// lib/simpleCache.js
//
// Tiny in-memory TTL cache — the same Map+expiresAt pattern
// routes/trending.js already used successfully, extracted here so it
// could be applied consistently to every OTHER endpoint that had none
// at all. Confirmed real problem this fixes: providers/geo/ipapi.js,
// routes/suggested.js, routes/search.js, routes/artistPage.js,
// routes/venuePage.js, and routes/countryPage.js were all making a
// fresh external API call (Ticketmaster, ipapi.co) on every single
// request, with zero reuse even for identical, back-to-back queries —
// a direct contributor to burning through daily rate-limit quotas far
// faster than necessary (Ticketmaster returned 429 "Rate limit quota
// violation" repeatedly in production logs).
//
// Deliberately per-process, in-memory only — no Redis/external store.
// Good enough for a single-instance deployment; if this ever runs as
// multiple instances behind a load balancer, each instance keeps its
// own cache, which just means the effective cache hit rate is lower
// than it could be, not that anything breaks.

function createCache() {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry || entry.expiresAt <= Date.now()) return undefined;
      return entry.value;
    },
    set(key, value, ttlMs) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

module.exports = { createCache };
