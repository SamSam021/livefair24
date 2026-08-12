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

async function getTrendingEvents(clientIp, env) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  const countryCode = detectedCountry || FALLBACK_COUNTRY;

  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const settled = await Promise.allSettled(
    providers.map((p) =>
      typeof p.searchEvents === 'function'
        ? p.searchEvents({ query: '', city: '', countryCode }, env)
        : Promise.resolve([])
    )
  );

  let results = [];
  settled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') results = results.concat(outcome.value);
  });

  return {
    detectedCountry: detectedCountry, // null if geolocation didn't resolve — distinct from the fallback actually used
    countryUsed: countryCode,
    demoMode,
    count: results.length,
    results: results.slice(0, 6), // homepage card grid shows 6
  };
}

module.exports = { getTrendingEvents, FALLBACK_COUNTRY };
