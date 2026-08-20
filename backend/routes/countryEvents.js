// routes/countryEvents.js
//
// GET /api/country-events?country=DE — real, live events for an entire
// country, used to power pages like /cities/germany/ instead of the
// hardcoded/fictional content they had before (fake "From $72" prices,
// href="#" city cards, and two of the site's fictional demo events —
// Rosa Calder, Nova Wren — hardcoded directly into the page). Groups
// events by real city (Ticketmaster's own venue.city.name) for the
// "top cities" summary cards, and returns the full date-sorted list for
// an "all upcoming events" section — everything here is a real, current
// Ticketmaster listing, including the real ev.url booking link; nothing
// invented to fill a gap.
//
// Cached per-country with a TTL (lazy: the first request for a given
// country pays the real broad-search cost, every request after that
// within the TTL is instant) — same reasoning as
// routes/concertCategories.js's cache, just keyed by country instead of
// being a single global entry, since this can be asked about any
// supported country. No background pre-warm yet (unlike trending.js /
// concertCategories.js) since this isn't a high-traffic entry point
// today — worth adding the same pattern later if that changes.

const registry = require('../providers/registry');

function slugify(str) {
  // Same NFD-decompose + strip approach as eventPage.js's own slugify —
  // kept in sync deliberately so the slug built here matches the real
  // canonical slug that page computes (e.g. "Waldbühne" -> "waldbuhne",
  // not a broken "waldb-hne"). Even if this ever drifts slightly,
  // /events/{eventId}/{slug}/ 301-redirects to the canonical slug, so a
  // near-miss here still lands on the right real page, just via one
  // extra redirect.
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildEventSlug(ev) {
  const parts = [ev.name, ev.city, ev.date].filter(Boolean);
  return slugify(parts.join('-')) || 'event';
}

const PAGES = 2; // 2 x 200 = up to 400 real events — enough for a country-wide "all upcoming" list without being excessive
const PAGE_SIZE = 200;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const cache = new Map(); // countryCode -> { value, expiresAt }

async function collectCountryEvents(tm, env, countryCode) {
  const all = [];
  for (let page = 0; page < PAGES; page++) {
    try {
      // allCategories deliberately omitted/false, same reasoning as
      // concertCategories.js — a country events page for a "concerts"
      // guide must never pull in sports.
      const results = await tm.searchEvents({ query: '', city: '', countryCode, limit: PAGE_SIZE, page }, env);
      if (!Array.isArray(results) || results.length === 0) break;
      all.push(...results);
    } catch (err) {
      console.warn('[countryEvents]', countryCode, 'page', page, err.message);
      break;
    }
  }
  return all;
}

async function computeCountryEvents(env, countryCode) {
  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  if (!tm || typeof tm.searchEvents !== 'function') {
    return { cities: [], events: [], demoMode: true };
  }

  const rawEvents = await collectCountryEvents(tm, env, countryCode);

  // Dedup by eventId (a paged broad search can return the same event
  // twice across pages in rare edge cases) and drop anything missing a
  // real city or date — can't group or sort what isn't there.
  const seen = new Set();
  const events = [];
  for (const ev of rawEvents) {
    if (!ev.eventId || seen.has(ev.eventId)) continue;
    if (!ev.city || !ev.date) continue;
    seen.add(ev.eventId);
    events.push({ ...ev, slug: buildEventSlug(ev) });
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const cityMap = new Map();
  for (const ev of events) {
    if (!cityMap.has(ev.city)) cityMap.set(ev.city, { name: ev.city, count: 0, minPrice: null, currency: ev.currency });
    const c = cityMap.get(ev.city);
    c.count += 1;
    if (ev.lowestPrice != null && (c.minPrice == null || ev.lowestPrice < c.minPrice)) c.minPrice = ev.lowestPrice;
  }

  const cities = Array.from(cityMap.values()).sort((a, b) => b.count - a.count);

  return { cities, events, demoMode: false };
}

async function getCountryEvents(env, countryCode) {
  const key = (countryCode || '').toUpperCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cacheHit: true };
  const fresh = await computeCountryEvents(env, key);
  cache.set(key, { value: fresh, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...fresh, cacheHit: false };
}

module.exports = { getCountryEvents };
