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
// Cached per-country with a 24h TTL, background-refreshed once per day
// (see startBackgroundCountryEventsRefresh below) — a real visitor's
// request should always hit this cache, never trigger the live fetch
// itself. Only DE is pre-warmed today, since that's the only country
// /cities/germany/ actually asks for; other countries (if ever used)
// still fall back to the old lazy-compute-on-first-request behavior.

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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — raised from 2h at the user's explicit request: this page should only make its real API calls once per day, background-refreshed, never triggered by a real visitor's own request.
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

// Background pre-warming, once per day — the actual fix for "this page
// should only make its real API calls once per day": only DE is
// pre-warmed (the only country /cities/germany/ actually requests).
// lowPriority:true marks these calls as background-triggered, same
// reasoning as every other background job — see providers/tickets/
// ticketmaster.js's two-lane priority queue.
const BACKGROUND_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours — once per day, matches CACHE_TTL_MS exactly
const PRE_WARMED_COUNTRIES = ['DE'];

async function backgroundRefreshCountryEvents() {
  const env = { ...registry.getMergedEnv(), lowPriority: true };
  for (const countryCode of PRE_WARMED_COUNTRIES) {
    try {
      const fresh = await computeCountryEvents(env, countryCode);
      cache.set(countryCode, { value: fresh, expiresAt: Date.now() + CACHE_TTL_MS });
    } catch (err) {
      console.warn('[countryEvents background refresh]', countryCode, err.message);
    }
  }
}

function startBackgroundCountryEventsRefresh() {
  backgroundRefreshCountryEvents().catch((err) => console.warn('[countryEvents background refresh]', err.message));
  setInterval(() => {
    backgroundRefreshCountryEvents().catch((err) => console.warn('[countryEvents background refresh]', err.message));
  }, BACKGROUND_REFRESH_INTERVAL_MS);
}

module.exports = { getCountryEvents, startBackgroundCountryEventsRefresh };
