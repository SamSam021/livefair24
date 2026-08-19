// routes/concertCategories.js
//
// GET /api/concerts/categories — powers the "Concerts" flyout menu
// (Rap/Hip Hop, Pop/Rock, Country/Folk, Techno/Electronic, Other),
// grouped from real, current Ticketmaster data — same broad-discovery
// pattern as routes/suggested.js, grouped by attractionId into real
// artists, then bucketed by lib/concertGenreBuckets.js's mapping of
// Ticketmaster's own documented genre classification. No artist name in
// this response is ever hardcoded — every one comes from a real,
// currently-listed Ticketmaster attraction with at least one real
// upcoming event.
//
// CACHING — added after confirmed real user-facing latency: fetching up
// to 9 pages (3 markets x 3 pages) fresh on every single menu open was
// exactly the kind of slow, expensive pipeline routes/trending.js had
// already hit and solved for the homepage's trending cards (see that
// file's own header comment — "confirmed in practice to take ~10
// seconds end to end"). This reuses that same proven shape: an
// in-memory cache with a TTL, plus a background job that refreshes it
// on a schedule so a real visitor's click almost always hits a warm
// cache instead of triggering the slow path themselves. Simpler than
// trending.js's version since this isn't per-visitor-country — one
// cache entry covers everyone, since the category menu already always
// queries the same fixed SITEMAP_MARKETS regardless of who's asking.

const registry = require('../providers/registry');
const { BUCKETS, bucketForGenre } = require('../lib/concertGenreBuckets');

const SITEMAP_MARKETS = ['US', 'DE', 'GB']; // same initial-launch markets as eventsSitemap.js / artistVenueSitemap.js
const MAX_PER_BUCKET = 6; // matches the reference layout's "5 + See all" per category
const PAGES_PER_MARKET = 3; // 3 x 200 = up to 600 real events per market — a single
  // 150-event page left rarer genres too small a sample to ever surface a
  // real result; this is still 100% real Ticketmaster data, just more of
  // it, not anything invented to fill a bucket artificially.
const PAGE_SIZE = 200; // Ticketmaster's documented max page size

// TTL comfortably longer than the refresh interval below, so the cache
// never goes cold between scheduled refreshes under normal operation —
// only matters on a cold start right after a deploy (in-memory, not
// persisted, same tradeoff trending.js already accepts).
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
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

async function collectMusicEventsAcrossMarkets(tm, env) {
  const all = [];
  await Promise.all(
    SITEMAP_MARKETS.map(async (countryCode) => {
      for (let page = 0; page < PAGES_PER_MARKET; page++) {
        try {
          // allCategories deliberately omitted/false — the provider applies
          // classificationName=music automatically in that case (see
          // ticketmaster.js), which is what a concerts-only category menu
          // needs; unlike routes/suggested.js this must never include sports.
          const results = await tm.searchEvents({ query: '', city: '', countryCode, limit: PAGE_SIZE, page }, env);
          if (!Array.isArray(results) || results.length === 0) break; // no more pages for this market
          all.push(...results);
        } catch (err) {
          console.warn('[concertCategories]', countryCode, 'page', page, err.message);
          break;
        }
      }
    })
  );
  return all;
}

// The actual expensive pipeline — discovery across markets/pages, real
// artist grouping, real genre bucketing. Never called directly by the
// route handler; always goes through getConcertCategories's cache below.
async function computeConcertCategories(env) {
  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  if (!tm || typeof tm.searchEvents !== 'function') {
    return { buckets: BUCKETS.map((b) => ({ ...b, artists: [] })), demoMode: true };
  }

  const events = await collectMusicEventsAcrossMarkets(tm, env);

  // Group into real, unique artists — same attractionId-required rule as
  // suggested.js, for the same reason (a one-off ticket product with no
  // shared attractionId isn't a coherent "artist" and would 404 on its
  // own hub page).
  const artistGroups = new Map();
  for (const ev of events) {
    if (!ev.name || !ev.eventId || !ev.attractionId) continue;
    const key = ev.attractionId;
    if (!artistGroups.has(key)) {
      artistGroups.set(key, { id: key, name: ev.name, count: 0, genreCounts: new Map(), imageUrl: null });
    }
    const g = artistGroups.get(key);
    g.count += 1;
    const genreName = ev.musicGenre || 'Other';
    g.genreCounts.set(genreName, (g.genreCounts.get(genreName) || 0) + 1);
    if (!g.imageUrl && ev.imageUrl) g.imageUrl = ev.imageUrl;
  }

  // Each bucket accumulates the real artists whose most common genre
  // maps into it, sorted by real current event count (most active
  // touring artists first) — never sorted alphabetically-as-if-curated
  // or padded with anything not actually found above.
  const byBucket = new Map(BUCKETS.map((b) => [b.key, []]));
  for (const g of artistGroups.values()) {
    let topGenre = 'Other';
    let topCount = -1;
    for (const [genreName, count] of g.genreCounts.entries()) {
      if (count > topCount) { topGenre = genreName; topCount = count; }
    }
    const bucketKey = bucketForGenre(topGenre);
    byBucket.get(bucketKey).push({
      id: g.id,
      name: g.name,
      slug: slugify(g.name),
      count: g.count,
      imageUrl: g.imageUrl,
    });
  }

  const buckets = BUCKETS.map((b) => ({
    ...b,
    artists: byBucket
      .get(b.key)
      .sort((a, z) => z.count - a.count)
      .slice(0, MAX_PER_BUCKET),
    // Real total so the frontend can show/link "See all N" instead of a
    // fixed, possibly-wrong label.
    totalCount: byBucket.get(b.key).length,
  }));

  return { buckets, demoMode: false };
}

async function getConcertCategories(env) {
  if (cachedResult && cacheExpiresAt > Date.now()) {
    return { ...cachedResult, cacheHit: true };
  }
  const fresh = await computeConcertCategories(env);
  cachedResult = fresh;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return { ...fresh, cacheHit: false };
}

async function backgroundRefreshConcertCategories() {
  // Re-reads env fresh on every cycle (not captured once at startup) —
  // same reasoning as trending.js's background refresh: a Ticketmaster
  // key added later via the admin panel gets picked up without needing
  // a server restart.
  const env = registry.getMergedEnv();
  try {
    const fresh = await computeConcertCategories(env);
    cachedResult = fresh;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  } catch (err) {
    // Existing cache entry (if any) just stays as-is until the next cycle.
    console.warn('[concertCategories background refresh]', err.message);
  }
}

function startBackgroundConcertCategoriesRefresh() {
  // Fire immediately on startup — don't make the very first visitor who
  // opens the menu after a deploy wait for the slow path — then keep
  // refreshing on the regular interval after that.
  backgroundRefreshConcertCategories().catch((err) => console.warn('[concertCategories background refresh]', err.message));
  setInterval(() => {
    backgroundRefreshConcertCategories().catch((err) => console.warn('[concertCategories background refresh]', err.message));
  }, BACKGROUND_REFRESH_INTERVAL_MS);
}

module.exports = { getConcertCategories, startBackgroundConcertCategoriesRefresh };
