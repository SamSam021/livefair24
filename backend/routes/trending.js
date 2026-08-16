// routes/trending.js
//
// Powers /api/trending — detects the visitor's country from their IP,
// then asks the ticket providers for real upcoming events in that
// country. This is deliberately separate from routes/search.js: search
// is keyword-driven and user-initiated, this is location-driven and
// automatic on page load. They share the same provider searchEvents()
// methods underneath, just called with a countryCode instead of a
// keyword.
//
// Full capability (price verification included) is kept intact here,
// even though the frontend currently doesn't display it as a
// comparison — permissions from other ticket providers are still being
// negotiated. If/when they're granted, showing multi-seller comparison
// again is a frontend change, not a rebuild of this pipeline. Until
// then, only Ticketmaster is shown, and nothing is framed as a
// "comparison" anywhere in the UI.

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
// picking the same soonest ones, so repeat visits see variety. This is
// for the FINAL display selection, made only from events already
// confirmed to have real pricing — full randomization here doesn't hurt
// pricing odds, unlike at the candidate-picking stage (see
// selectDiverseSoonest below).
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

// For picking which candidates to spend a verification API call on —
// deliberately NOT randomized like selectDiverseRandom above. Near-term
// events are markedly more likely to have on-sale pricing populated yet
// than far-future ones. Preserves the input's date order (discovery
// already sorts date,asc) and takes the FIRST — i.e. soonest —
// occurrence of each distinct artist, maximizing the odds that a
// limited number of verification calls actually finds priced events.
function selectDiverseSoonest(events, targetCount) {
  const selected = [];
  const usedArtists = new Set();

  for (const ev of events) {
    if (selected.length >= targetCount) break;
    const key = attractionKey(ev);
    if (!key || usedArtists.has(key)) continue;
    usedArtists.add(key);
    selected.push(ev);
  }

  if (selected.length < targetCount) {
    for (const ev of events) {
      if (selected.length >= targetCount) break;
      if (!selected.includes(ev)) selected.push(ev);
    }
  }

  return selected;
}

// Explicit, not assumed: only events at or after today are eligible,
// regardless of what a provider's default sort/filtering already does.
// Deliberately compares by DATE ONLY, not date+time — ev.time is the
// VENUE'S LOCAL time, with no reliable way to know that venue's UTC
// offset, so comparing full date+time against server "now" can
// misjudge same-day events. Day-level comparison sidesteps that.
function isUpcoming(ev) {
  if (!ev.date) return false;
  const todayDateStr = new Date().toISOString().slice(0, 10);
  return ev.date >= todayDateStr;
}

// No valid ticket price, no card — an event we can't show a real price
// for shouldn't appear as a trending card at all.
function hasRealPrice(ev) {
  return ev.lowestPrice != null;
}

// A concert happening in a few hours (or even a few days) isn't
// realistic for someone to plan around — shown cards need at least
// MIN_LEAD_DAYS of notice.
const MIN_LEAD_DAYS = 14;
function hasMinimumLeadTime(ev) {
  if (!ev.date) return false;
  const minDateStr = new Date(Date.now() + MIN_LEAD_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return ev.date >= minDateStr;
}

function daysBetweenDateStrings(dateStrA, dateStrB) {
  const a = new Date(dateStrA + 'T00:00:00Z');
  const b = new Date(dateStrB + 'T00:00:00Z');
  return Math.abs((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

// Spreads selected cards across different dates rather than clustering
// on the same day — greedily walks the (already diversity-ordered)
// candidate list, only accepting an event if its date is far enough
// from every one already picked. Tops up with whatever's left, spacing
// constraint dropped, if there simply aren't enough distinct dates to
// fill every slot.
const MIN_DAYS_BETWEEN_CARDS = 3;
function applyDateSpacing(events, targetCount, minDaysApart) {
  const selected = [];
  for (const ev of events) {
    if (selected.length >= targetCount) break;
    if (!ev.date || selected.every((s) => !s.date || daysBetweenDateStrings(s.date, ev.date) >= minDaysApart)) {
      selected.push(ev);
    }
  }
  if (selected.length < targetCount) {
    for (const ev of events) {
      if (selected.length >= targetCount) break;
      if (!selected.includes(ev)) selected.push(ev);
    }
  }
  return selected;
}

// An event isn't onsale yet cannot have pricing, regardless of how it's
// queried. Treats a missing/unknown status as passing rather than
// excluding it — providers without this field shouldn't be penalized
// for a field we can't read, only ones explicitly NOT onsale.
function isOnSaleOrUnknown(ev) {
  return !ev.saleStatus || ev.saleStatus === 'onsale';
}

// How many discovered candidates to re-check for real pricing. Higher
// means a better chance of finding TARGET_COUNT priced events, at the
// cost of more provider API calls.
const CANDIDATES_TO_VERIFY = 25;

// Ticketmaster's documented rate limit is 5 requests/second. Batching at
// a conservative size with a pause between batches keeps this safely
// under the limit rather than firing everything at once.
const VERIFY_BATCH_SIZE = 4;
const VERIFY_BATCH_DELAY_MS = 1100;

async function runInBatches(items, batchSize, delayMs, fn) {
  const settled = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchSettled = await Promise.allSettled(batch.map(fn));
    settled.push(...batchSettled);
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return settled;
}

// Trending concert data doesn't need to be re-fetched fresh on every
// single page load — the discovery+verification pipeline is genuinely
// expensive. In-memory only (not persisted across restarts).
const CACHE_TTL_MS = 18 * 60 * 60 * 1000; // 18 hours — long enough to outlast a full background-refresh rotation (see below)
const trendingCache = new Map(); // cacheKey -> { data, expiresAt }

// Proactively refreshes cached trending data on a schedule, so real
// visitors never have to wait for the slow pipeline themselves. Budgeted
// to roughly 200 Ticketmaster API calls/day total — rotating through ONE
// supported country per cycle (not all 5 every cycle, which would cost
// ~37,000 calls/day and exhaust a free-tier quota in about 2 hours).
const BACKGROUND_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
let backgroundRefreshRotationIndex = 0;

async function backgroundRefreshTrending() {
  const env = registry.getMergedEnv();
  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');
  if (demoMode) return; // nothing slow to pre-warm — demo mode is always instant

  const countriesToWarm = [];
  for (const p of providers) {
    if (Array.isArray(p.pricingSupportedCountries)) {
      p.pricingSupportedCountries.forEach((c) => { if (!countriesToWarm.includes(c)) countriesToWarm.push(c); });
    }
  }
  if (countriesToWarm.length === 0) countriesToWarm.push(FALLBACK_COUNTRY);

  const country = countriesToWarm[backgroundRefreshRotationIndex % countriesToWarm.length];
  backgroundRefreshRotationIndex += 1;

  try {
    const { queryCountry, usedPricingFallback } = resolvePricingCountry(providers, country);
    const fresh = await runTrendingPipeline(queryCountry, demoMode, usedPricingFallback, country, providers, env);
    trendingCache.set(`${queryCountry}:real`, { data: fresh, expiresAt: Date.now() + CACHE_TTL_MS });
  } catch (err) {
    console.warn(`[trending background refresh] failed for ${country}:`, err.message);
  }
}

function startBackgroundTrendingRefresh() {
  backgroundRefreshTrending().catch((err) => console.warn('[trending background refresh]', err.message));
  setInterval(() => {
    backgroundRefreshTrending().catch((err) => console.warn('[trending background refresh]', err.message));
  }, BACKGROUND_REFRESH_INTERVAL_MS);
}

// Determines which country to actually query. If any enabled provider
// supports pricing for the visitor's real country, uses it as-is. If
// none do, falls back to a country that SOME enabled provider does
// support, so trending still shows something real rather than nothing.
function resolvePricingCountry(providers, requestedCountry) {
  const anySupportsRequested = providers.some((p) =>
    typeof p.isCountrySupportedForPricing !== 'function' || p.isCountrySupportedForPricing(requestedCountry)
  );
  if (anySupportsRequested) {
    return { queryCountry: requestedCountry, usedPricingFallback: false };
  }
  for (const p of providers) {
    if (typeof p.getFallbackPricingCountry === 'function') {
      const fallback = p.getFallbackPricingCountry();
      if (fallback) return { queryCountry: fallback, usedPricingFallback: true };
    }
  }
  return { queryCountry: requestedCountry, usedPricingFallback: false };
}

async function getTrendingEvents(clientIp, env, overrideCountry) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  const requestedCountry = overrideCountry || detectedCountry || FALLBACK_COUNTRY;

  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const { queryCountry, usedPricingFallback } = resolvePricingCountry(providers, requestedCountry);
  const countryCode = queryCountry;

  const cacheKey = `${countryCode}:${demoMode ? 'demo' : 'real'}`;
  const cached = trendingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, detectedCountry, cacheHit: true };
  }

  const fresh = await runTrendingPipeline(countryCode, demoMode, usedPricingFallback, requestedCountry, providers, env);
  trendingCache.set(cacheKey, { data: fresh, expiresAt: Date.now() + CACHE_TTL_MS });
  return { ...fresh, detectedCountry, cacheHit: false };
}

async function runTrendingPipeline(countryCode, demoMode, usedPricingFallback, requestedCountry, providers, env) {
  const debug = { discoveredCount: 0, upcomingCount: 0, candidatesChecked: 0, verifyErrors: 0, verifiedRawCount: 0, eligibleCount: 0 };
  if (usedPricingFallback) {
    debug.pricingFallback = `${requestedCountry} not supported for pricing by any enabled provider — querying ${countryCode} instead`;
  }

  const minLeadIso = new Date(Date.now() + MIN_LEAD_DAYS * 24 * 60 * 60 * 1000).toISOString().split('.')[0] + 'Z';
  const discoverySettled = await Promise.allSettled(
    providers.map((p) =>
      typeof p.searchEvents === 'function'
        ? p.searchEvents({ query: '', city: '', countryCode, limit: 150, dateFrom: minLeadIso }, env)
        : Promise.resolve([])
    )
  );
  let discovered = [];
  const discoveryErrors = [];
  discoverySettled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') discovered = discovered.concat(outcome.value);
    else discoveryErrors.push(String(outcome.reason && outcome.reason.message || outcome.reason));
  });
  debug.discoveredCount = discovered.length;
  if (discoveryErrors.length) debug.discoveryErrors = discoveryErrors;
  debug.discoveredDateSample = discovered.slice(0, 5).map((ev) => ({ name: ev.name, date: ev.date, time: ev.time }));

  const upcomingDiscovered = discovered.filter(isUpcoming);
  debug.upcomingCount = upcomingDiscovered.length;
  if (upcomingDiscovered.length === 0) {
    return { countryUsed: countryCode, demoMode, count: 0, results: [], debug };
  }

  const onSaleDiscovered = upcomingDiscovered.filter(isOnSaleOrUnknown);
  debug.onSaleCount = onSaleDiscovered.length;
  debug.saleStatusSample = upcomingDiscovered.slice(0, 8).map((ev) => ev.saleStatus);
  const discoveryPool = onSaleDiscovered.length > 0 ? onSaleDiscovered : upcomingDiscovered;

  const candidates = selectDiverseSoonest(discoveryPool, CANDIDATES_TO_VERIFY);
  debug.candidatesChecked = candidates.length;
  debug.candidateSample = candidates.slice(0, 5).map((c) => ({ name: c.name, url: c.url }));

  const verifySettled = await runInBatches(candidates, VERIFY_BATCH_SIZE, VERIFY_BATCH_DELAY_MS, async (cand) => {
    const sourceProvider = providers.find((p) => p.id === cand.source);
    if (sourceProvider && typeof sourceProvider.getEventDetails === 'function' && cand.eventId) {
      const detail = await sourceProvider.getEventDetails(cand.eventId, env);
      return detail ? [detail] : [];
    }
    const fallbackResults = await Promise.all(
      providers.map((p) =>
        typeof p.searchEvents === 'function'
          ? p.searchEvents({ query: cand.name, city: cand.city, countryCode }, env)
          : Promise.resolve([])
      )
    );
    return fallbackResults.flat();
  });
  let verified = [];
  let candidatesWithNoResult = 0;
  verifySettled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') {
      if (outcome.value.length === 0) candidatesWithNoResult += 1;
      verified = verified.concat(outcome.value);
    } else {
      debug.verifyErrors += 1;
    }
  });
  debug.verifiedRawCount = verified.length;
  debug.candidatesWithNoResult = candidatesWithNoResult;

  const eligible = verified.filter(isUpcoming);
  debug.verifiedUpcomingCount = eligible.length;
  const priced = eligible.filter(hasRealPrice);
  debug.pricedBeforeLeadTimeFilter = priced.length;
  const withLeadTime = priced.filter(hasMinimumLeadTime);
  debug.eligibleCount = withLeadTime.length;

  const diverseOrdered = selectDiverseRandom(withLeadTime, withLeadTime.length);
  const selected = applyDateSpacing(diverseOrdered, TARGET_COUNT, MIN_DAYS_BETWEEN_CARDS);

  return {
    countryUsed: countryCode,
    demoMode,
    count: selected.length,
    results: selected,
    debug,
  };
}

module.exports = { getTrendingEvents, FALLBACK_COUNTRY, startBackgroundTrendingRefresh };
