// routes/search.js
//
// Powers /api/search — the actual multi-source aggregation the site needs:
// query every enabled ticket provider's searchEvents(), merge everything
// into one list, sort by price. Today that's just Ticketmaster (SeatGeek
// needs a client ID you haven't set) plus the demo fallback. Adding a new
// source later (another ticket API, or eventually sports data) means only
// giving that provider its own searchEvents() method — this aggregation
// logic doesn't change at all.
//
// Accepts a keyword (q), and/or a city, and/or a date range — at least one
// must be present. This lets a visitor search "everything in Berlin this
// weekend" with no artist keyword at all, not just "keyword only."

const registry = require('../providers/registry');

async function searchEvents(params, env) {
  const query = (params.q || '').trim();
  const city = (params.city || '').trim();
  const dateFrom = params.dateFrom || null;
  const dateTo = params.dateTo || null;
  // Only ever 'all' when the request originated from the homepage's
  // search bar (never the dedicated /concerts/ page) — removes the
  // concerts-only restriction downstream in the ticket provider, so
  // results can include any real category Ticketmaster has, not just
  // music.
  const allCategories = params.scope === 'all';

  if (!query && !city && !dateFrom) {
    return { query, city, dateFrom, dateTo, demoMode: true, count: 0, results: [] };
  }

  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const searchParams = { query, city, dateFrom, dateTo, allCategories };
  const settled = await Promise.allSettled(
    providers.map((p) => (typeof p.searchEvents === 'function' ? p.searchEvents(searchParams, env) : Promise.resolve([])))
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
    query,
    city,
    dateFrom,
    dateTo,
    demoMode,
    providersUsed: providers.map((p) => p.id),
    count: results.length,
    results,
  };
}

module.exports = { searchEvents };
