// routes/countryPage.js
//
// Powers /cities/{country}/ — replaces what was previously a fully
// hardcoded static page (fabricated stats, fake per-city counts/prices,
// two fictional events dressed up as live results, several dead
// href="#" links) with real, live Ticketmaster data for that country.
//
// Confirmed real problem this fixes: the old cities/germany/index.html
// showed "12 upcoming concerts" / "$38 cheapest ticket" as static text,
// city cards with invented counts/prices linking to href="#", and an
// "All upcoming Germany concerts" section listing exactly the same two
// fictional demo events (Rosa Calder, Nova Wren) used as this site's
// fallback content elsewhere — captioned "sorted by date · prices
// updated every 2 minutes", which was false for a page that never
// actually updated.
//
// Per-city breakdown is built directly from whichever cities the real
// search results actually contain — not filtered to the curated
// major-cities list (data/major-cities.js), since that list exists for
// a different purpose (a stable, recognizable set of cities to always
// show regardless of live inventory, used by the homepage carousel).
// Here, the live data itself is the source of truth: a city only
// appears if it genuinely has a real, current event.

const registry = require('../providers/registry');
const { createCache } = require('../lib/simpleCache');

const countryCache = createCache();
const SUCCESS_TTL_MS = 5 * 60 * 1000; // 5 minutes, matching trending.js's/suggested.js's own window
const FAILURE_TTL_MS = 60 * 1000; // short — avoid hammering an already-rate-limited API

async function getCountryConcerts(countryCode, env) {
  // Confirmed real problem this fixes: this endpoint made a fresh
  // size=150 Ticketmaster search on every single request with zero
  // caching, contributing directly to the rate-limit incident that
  // motivated adding caching across every endpoint that lacked it.
  const cached = countryCache.get(countryCode);
  if (cached) return cached;

  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  if (!tm || typeof tm.searchEvents !== 'function') {
    return { countryCode, count: 0, cheapestPrice: null, cities: [], events: [] };
  }

  let results = [];
  try {
    results = await tm.searchEvents({ query: '', city: '', countryCode, limit: 150 }, env);
  } catch (err) {
    console.warn('[country page]', err.message);
    const failureResult = { countryCode, count: 0, cheapestPrice: null, cities: [], events: [] };
    countryCache.set(countryCode, failureResult, FAILURE_TTL_MS);
    return failureResult;
  }

  const realEvents = (results || []).filter((ev) => ev.city && ev.venue && ev.date);

  const cityMap = new Map(); // cityName -> { name, count, cheapestPrice }
  let cheapestOverall = null;

  for (const ev of realEvents) {
    if (ev.lowestPrice != null) {
      cheapestOverall = cheapestOverall == null ? ev.lowestPrice : Math.min(cheapestOverall, ev.lowestPrice);
    }
    if (!cityMap.has(ev.city)) cityMap.set(ev.city, { name: ev.city, count: 0, cheapestPrice: null });
    const c = cityMap.get(ev.city);
    c.count += 1;
    if (ev.lowestPrice != null) {
      c.cheapestPrice = c.cheapestPrice == null ? ev.lowestPrice : Math.min(c.cheapestPrice, ev.lowestPrice);
    }
  }

  const cities = [...cityMap.values()].sort((a, b) => b.count - a.count);

  const events = realEvents
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(0, 20);

  const finalResult = {
    countryCode,
    count: realEvents.length,
    cheapestPrice: cheapestOverall,
    cities,
    events,
  };
  countryCache.set(countryCode, finalResult, SUCCESS_TTL_MS);
  return finalResult;
}

module.exports = { getCountryConcerts };
