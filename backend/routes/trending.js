// routes/trending.js
//
// Powers /api/trending — detects the visitor's country from their IP,
// then asks the ticket providers for real upcoming events in that
// country. This is deliberately separate from routes/search.js: search
// is keyword-driven and user-initiated, this is location-driven and
// automatic on page load. They share the same provider searchEvents()
// methods underneath, just called with a countryCode instead of a
// keyword.

const ipapi = require('../providers/geo/ipapi');
const registry = require('../providers/registry');

// Fallback when geolocation fails or the visitor is local/private —
// showing something is better than nothing, and US has the broadest
// Ticketmaster coverage.
const FALLBACK_COUNTRY = 'US';

const TARGET_COUNT = 6; // homepage card grid shows 6

// Ticketmaster's relevance sort with no keyword tends to surface many
// dates (and ticket-tier variants like "... | Premium Packages") of
// whichever single act is most popular right now, rather than a variety
// of different artists — confirmed by real output showing the same tour
// six times over. Deduplicating by attraction ID (the real artist
// identifier, not a name guess) fixes that.
function dedupeByAttraction(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    // Fall back to a normalized name (stripping " | Ticket Tier" suffixes)
    // for results with no attractionId at all, so dedup still does
    // something useful rather than passing everything through unfiltered.
    const key = ev.attractionId || (ev.name || '').split('|')[0].trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

// Many Ticketmaster events genuinely have no priceRanges data in this
// endpoint (a real characteristic of their API, not a bug) — showing
// those with a blank price looked broken. Filtering them out means every
// card shown has a real number, at the cost of needing more raw
// candidates to fill 6 slots (handled by requesting a larger limit below).
function hasRealPrice(ev) {
  return ev.lowestPrice != null;
}

async function getTrendingEvents(clientIp, env) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  const countryCode = detectedCountry || FALLBACK_COUNTRY;

  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const settled = await Promise.allSettled(
    providers.map((p) =>
      typeof p.searchEvents === 'function'
        // Requesting more than TARGET_COUNT here deliberately — after
        // deduping repeat tour dates and filtering out events with no
        // price data, a raw fetch of just 6 could easily end up with far
        // fewer (or zero) usable results.
        ? p.searchEvents({ query: '', city: '', countryCode, limit: 40 }, env)
        : Promise.resolve([])
    )
  );

  let results = [];
  settled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') results = results.concat(outcome.value);
  });

  const filtered = dedupeByAttraction(results).filter(hasRealPrice);

  return {
    detectedCountry: detectedCountry, // null if geolocation didn't resolve — distinct from the fallback actually used
    countryUsed: countryCode,
    demoMode,
    count: filtered.length,
    results: filtered.slice(0, TARGET_COUNT),
  };
}

module.exports = { getTrendingEvents, FALLBACK_COUNTRY };
