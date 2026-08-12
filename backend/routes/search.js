// routes/search.js
//
// Powers /api/search — the actual multi-source aggregation the site needs:
// query every enabled ticket provider's searchEvents(), merge everything
// into one list, sort by price. Today that's just Ticketmaster (SeatGeek
// needs a client ID you haven't set) plus the demo fallback. Adding a new
// source later (another ticket API, or eventually sports data) means only
// giving that provider its own searchEvents() method — this aggregation
// logic doesn't change at all.

const registry = require('../providers/registry');

async function searchEvents(queryText, env) {
  const trimmed = (queryText || '').trim();
  if (!trimmed) {
    return { query: '', demoMode: true, count: 0, results: [] };
  }

  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const settled = await Promise.allSettled(
    providers.map((p) => (typeof p.searchEvents === 'function' ? p.searchEvents(trimmed, env) : Promise.resolve([])))
  );

  let results = [];
  settled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') results = results.concat(outcome.value);
  });

  // Sort by price ascending — the whole point of aggregating multiple
  // sources is showing the cheapest option first regardless of which
  // provider it came from. Events with no known price sort to the end.
  results.sort((a, b) => {
    if (a.lowestPrice == null && b.lowestPrice == null) return 0;
    if (a.lowestPrice == null) return 1;
    if (b.lowestPrice == null) return -1;
    return a.lowestPrice - b.lowestPrice;
  });

  return {
    query: trimmed,
    demoMode,
    providersUsed: providers.map((p) => p.id),
    count: results.length,
    results,
  };
}

module.exports = { searchEvents };
