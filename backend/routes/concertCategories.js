// routes/concertCategories.js
//
// GET /api/concerts/categories — powers the "Concerts" flyout menu
// (Rap/Hip Hop, Pop/Rock, Country/Folk, Techno/Electronic, Music
// Festivals, Other), grouped from real, current Ticketmaster data —
// same broad-discovery pattern as routes/suggested.js (a size=150
// country search), grouped by attractionId into real artists, then
// bucketed by lib/concertGenreBuckets.js's mapping of Ticketmaster's
// own documented genre classification. No artist name in this response
// is ever hardcoded — every one comes from a real, currently-listed
// Ticketmaster attraction with at least one real upcoming event.

const registry = require('../providers/registry');
const { BUCKETS, bucketForGenre } = require('../lib/concertGenreBuckets');

const SITEMAP_MARKETS = ['US', 'DE', 'GB']; // same initial-launch markets as eventsSitemap.js / artistVenueSitemap.js
const MAX_PER_BUCKET = 6; // matches the reference layout's "5 + See all" per category

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
      try {
        // allCategories deliberately omitted/false — the provider applies
        // classificationName=music automatically in that case (see
        // ticketmaster.js), which is what a concerts-only category menu
        // needs; unlike routes/suggested.js this must never include sports.
        const results = await tm.searchEvents({ query: '', city: '', countryCode, limit: 150 }, env);
        if (Array.isArray(results)) all.push(...results);
      } catch (err) {
        console.warn('[concertCategories]', countryCode, err.message);
      }
    })
  );
  return all;
}

async function getConcertCategories(env) {
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

module.exports = { getConcertCategories };
