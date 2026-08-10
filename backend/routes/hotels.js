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

  return {
    demoMode,
    providersUsed: providers.map((p) => p.id),
    count: results.length,
    results,
  };
}

module.exports = { handleHotels };
