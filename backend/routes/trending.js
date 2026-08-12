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

function attractionKey(ev) {
  // Falls back to a normalized name (stripping " | Ticket Tier" suffixes
  // like "| Premium Packages") for results with no attractionId at all,
  // so diversity grouping still does something useful rather than
  // treating every result as a unique "artist".
  return ev.attractionId || (ev.name || '').split('|')[0].trim().toLowerCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Prefers a different artist per card, but tops up with additional
// events from an already-used artist if the pool doesn't have enough
// distinct ones — never returns fewer cards than the pool could support
// just to protect diversity. Also randomizes selection (which artist,
// and which of their dates) rather than deterministically always
// picking the same soonest ones, so repeat visits see variety.
// Verified against three cases before wiring in: plenty of diversity,
// scarce diversity (must top up with repeats), and a pool smaller than
// the target (must not pad with anything fake).
function selectDiverseRandom(events, targetCount) {
  const byArtist = new Map();
  for (const ev of events) {
    const key = attractionKey(ev);
    if (!key) continue;
    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(ev);
  }

  const artistKeys = shuffle([...byArtist.keys()]);
  const selected = [];

  for (const key of artistKeys) {
    if (selected.length >= targetCount) break;
    const pool = byArtist.get(key);
    selected.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  if (selected.length < targetCount) {
    const remaining = shuffle(events.filter((ev) => !selected.includes(ev)));
    for (const ev of remaining) {
      if (selected.length >= targetCount) break;
      selected.push(ev);
    }
  }

  return selected;
}

// Explicit, not assumed: only events at or after this moment are
// eligible, regardless of what a provider's default sort/filtering
// already does — removes any reliance on an assumption about default
// behavior that could silently change.
function isUpcoming(ev) {
  if (!ev.date) return false;
  const eventDateTime = new Date(`${ev.date}T${ev.time || '00:00:00'}`);
  return eventDateTime.getTime() >= Date.now();
}

// No valid ticket price, no card — explicit product requirement, not a
// soft preference like artist diversity. Never fill this gap with a
// fake, estimated, or placeholder price.
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
        // filtering for upcoming+priced events, a raw fetch of just 6
        // could easily end up with far fewer usable candidates to choose
        // a diverse, random selection from.
        ? p.searchEvents({ query: '', city: '', countryCode, limit: 40 }, env)
        : Promise.resolve([])
    )
  );

  let results = [];
  settled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') results = results.concat(outcome.value);
  });

  const eligible = results.filter(isUpcoming).filter(hasRealPrice);
  const selected = selectDiverseRandom(eligible, TARGET_COUNT);

  return {
    detectedCountry: detectedCountry, // null if geolocation didn't resolve — distinct from the fallback actually used
    countryUsed: countryCode,
    demoMode,
    count: selected.length,
    results: selected,
  };
}

module.exports = { getTrendingEvents, FALLBACK_COUNTRY };
