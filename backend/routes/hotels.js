// routes/hotels.js
//
// GET /api/hotels?lat=...&lng=...&checkIn=...&checkOut=...&eventId=...
//
// Same aggregation pattern as routes/tickets.js.

const registry = require('../providers/registry');

async function handleHotels(query, env) {
  const providers = registry.getEnabledHotelProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const settled = await Promise.allSettled(
    providers.map((p) => p.search(query, env))
  );

  let results = [];
  settled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') results = results.concat(outcome.value);
  });

  results.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));

  // Diagnostic-only: any provider that exposes getLastError() (currently
  // just stayapi.js) gets its last failure reason surfaced right here in
  // the response — server-log access turned out to be impractical to
  // get to in practice, so this makes the real error visible just by
  // hitting this endpoint directly. Omitted entirely when there's
  // nothing to report, so it never appears on a normal successful call.
  const providerErrors = {};
  providers.forEach((p) => {
    if (typeof p.getLastError === 'function') {
      const err = p.getLastError();
      if (err) providerErrors[p.id] = err;
    }
  });

  const response = {
    demoMode,
    providersUsed: providers.map((p) => p.id),
    count: results.length,
    results,
  };
  if (Object.keys(providerErrors).length > 0) response.providerErrors = providerErrors;

  return response;
}

module.exports = { handleHotels };
