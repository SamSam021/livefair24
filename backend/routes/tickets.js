// routes/tickets.js
//
// GET /api/tickets?artist=...&city=...&basePrice=...&eventId=...
//
// Calls search() on every enabled ticket provider in parallel, merges the
// results, sorts by total price ascending, and returns them along with
// which providers were used and whether we're in demo mode.

const registry = require('../providers/registry');

async function handleTickets(query, env) {
  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const settled = await Promise.allSettled(
    providers.map((p) => p.search(query, env))
  );

  let results = [];
  settled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') results = results.concat(outcome.value);
  });

  results.sort((a, b) => a.total - b.total);
  if (results.length > 0) results[0].isBestPrice = true;

  return {
    demoMode,
    providersUsed: providers.map((p) => p.id),
    count: results.length,
    results,
  };
}

module.exports = { handleTickets };
