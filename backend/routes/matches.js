// routes/matches.js
//
// GET /api/matches — real, live upcoming sports events for the homepage/
// concerts/sports pages' "Upcoming matches" carousel, replacing the
// single fictional demo match (FC Bergkristall vs Rheingold United)
// that was hardcoded directly into those pages' HTML. Every match here
// comes from Ticketmaster's real Sports segment (classificationName=
// Sports — see the new override added in providers/tickets/
// ticketmaster.js's searchEvents) across the same launch markets used
// elsewhere on the site. Unlike db/queries/sports.js (which only ever
// returns the fictional demo seed data — no real sports provider is
// connected there), this is genuinely live.
//
// Same caching shape as routes/concertCategories.js: an in-memory cache
// with a TTL, plus a background job that refreshes it on a schedule so
// a real visitor's page load almost always hits a warm cache instead of
// triggering the slow multi-market broad-search path themselves.

const registry = require('../providers/registry');

const SITEMAP_MARKETS = ['US', 'DE', 'GB']; // same initial-launch markets as eventsSitemap.js / artistVenueSitemap.js / concertCategories.js
const MAX_MATCHES = 12; // enough for a real carousel without being excessive
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — same as concertCategories.js
const BACKGROUND_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
let cachedResult = null;
let cacheExpiresAt = 0;

function slugify(str) {
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

async function collectSportsEventsAcrossMarkets(tm, env) {
  const all = [];
  await Promise.all(
    SITEMAP_MARKETS.map(async (countryCode) => {
      try {
        const results = await tm.searchEvents({ query: '', city: '', countryCode, limit: 100, classificationName: 'Sports' }, env);
        if (Array.isArray(results)) all.push(...results);
      } catch (err) {
        console.warn('[matches]', countryCode, err.message);
      }
    })
  );
  return all;
}

async function computeMatches(env) {
  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  if (!tm || typeof tm.searchEvents !== 'function') {
    return { matches: [], demoMode: true };
  }

  const rawEvents = await collectSportsEventsAcrossMarkets(tm, env);

  const seen = new Set();
  const matches = [];
  for (const ev of rawEvents) {
    if (!ev.eventId || seen.has(ev.eventId)) continue;
    if (!ev.name || !ev.date) continue;
    seen.add(ev.eventId);
    matches.push({ ...ev, slug: buildEventSlug(ev) });
  }

  matches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { matches: matches.slice(0, MAX_MATCHES), demoMode: false };
}

async function getMatches(env) {
  if (cachedResult && cacheExpiresAt > Date.now()) {
    return { ...cachedResult, cacheHit: true };
  }
  const fresh = await computeMatches(env);
  cachedResult = fresh;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return { ...fresh, cacheHit: false };
}

async function backgroundRefreshMatches() {
  const env = registry.getMergedEnv();
  try {
    const fresh = await computeMatches(env);
    cachedResult = fresh;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  } catch (err) {
    console.warn('[matches background refresh]', err.message);
  }
}

function startBackgroundMatchesRefresh() {
  backgroundRefreshMatches().catch((err) => console.warn('[matches background refresh]', err.message));
  setInterval(() => {
    backgroundRefreshMatches().catch((err) => console.warn('[matches background refresh]', err.message));
  }, BACKGROUND_REFRESH_INTERVAL_MS);
}

module.exports = { getMatches, startBackgroundMatchesRefresh };
