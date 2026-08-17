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
// picking the same soonest ones, so repeat visits see variety. This is
// for the FINAL display selection, made only from events already
// confirmed to have real pricing — full randomization here doesn't hurt
// pricing odds, unlike at the candidate-picking stage (see
// selectDiverseSoonest below).
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

// For picking which candidates to spend a verification API call on —
// deliberately NOT randomized like selectDiverseRandom above. Confirmed
// via a real debug trace that fully randomizing here can select
// candidates scattered across a wide date range, and events further out
// are markedly less likely to have on-sale pricing populated yet.
// Preserves the input's date order (discovery already sorts date,asc)
// and takes the FIRST — i.e. soonest — occurrence of each distinct
// artist, maximizing the odds that a limited number of verification
// calls actually finds priced events. Still prefers diversity the same
// way selectDiverseRandom does (one per artist first, top up with
// repeats only if the pool lacks enough distinct artists).
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
//
// Deliberately compares by DATE ONLY, not date+time — confirmed via real
// evidence that comparing full date+time against server "now" was
// wrong: ev.time is the VENUE'S LOCAL time (e.g. a US evening show),
// but this had no reliable way to know that venue's UTC offset, so it
// was constructing a Date as if that time were already in the server's
// own timezone. That silently rejected same-day events happening later
// today whenever the mismatch pushed the comparison the wrong way —
// confirmed by a debug trace showing 40 discovered events, ALL dated
// today, ALL still rejected. Day-level comparison sidesteps the
// mismatch entirely: it can misjudge "today" by at most a few hours
// around midnight, never by the weeks/months a timezone bug at
// date+time precision could cause. Genuinely past dates (yesterday,
// last month, last year) are still reliably excluded either way.
function isUpcoming(ev) {
  if (!ev.date) return false;
  const todayDateStr = new Date().toISOString().slice(0, 10);
  return ev.date >= todayDateStr;
}

// No valid ticket price, no card — explicit product requirement, not a
// soft preference like artist diversity. Never fill this gap with a
// fake, estimated, or placeholder price.
function hasRealPrice(ev) {
  return ev.lowestPrice != null;
}

// Some venues come back from the provider with no geocoded location at
// all (Ticketmaster doesn't always have lat/lng for every venue). Without
// real coordinates the hotel map on the event/match page has nothing to
// center on — it renders as an empty gray tile grid with a hotel pin
// floating on it, per the actual bug this was written to fix. Dropping
// these here (server-side, once) means every page that shows a card is
// protected, instead of relying on each frontend page remembering to
// filter client-side.
function hasCoordinates(ev) {
  return ev.lat != null && ev.lng != null && !Number.isNaN(ev.lat) && !Number.isNaN(ev.lng);
}

// A concert happening in a few hours (or even a few days) isn't
// realistic for someone to plan around — explicit requirement that
// shown cards need at least MIN_LEAD_DAYS of notice. Applied to the
// final priced pool, not the raw discovery pool, so it doesn't waste
// verification calls filtering candidates that would be excluded anyway
// for other reasons first.
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

// Real evidence: two selected cards both landed on the exact same date
// and time — realistic for a big market with a lot happening, but reads
// as a bug, not a curated selection. Greedily walks the (already
// diversity-ordered) candidate list, only accepting an event if its date
// is far enough from every one already picked. Tops up with whatever's
// left, spacing constraint dropped, if there simply aren't enough
// distinct dates to fill every slot — same "don't return fewer cards
// than the pool could support" principle used for artist diversity.
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

// An event can be listed and discoverable before tickets actually go on
// sale — confirmed via a real captured response showing dates.status.code.
// Filtering for this BEFORE spending a verification call on a candidate
// avoids wasting requests on events that structurally cannot have
// pricing yet, regardless of query strategy. Treats a missing/unknown
// status as passing rather than excluding it — providers without this
// field (or events where Ticketmaster simply omits it) shouldn't be
// penalized for a field we can't read, only ones explicitly NOT onsale.
function isOnSaleOrUnknown(ev) {
  return !ev.saleStatus || ev.saleStatus === 'onsale';
}

// How many discovered candidates to re-check for real pricing. Raised
// from 15 after confirming real usage where only 2 of 15 had pricing —
// even in a supported market, most events apparently lack it. Higher
// improves the odds of finding TARGET_COUNT priced events, at the cost
// of more provider API calls — mitigated below by throttling rather
// than firing them all at once.
const CANDIDATES_TO_VERIFY = 25;

// Ticketmaster's documented rate limit is 5 requests/second. Firing all
// CANDIDATES_TO_VERIFY requests simultaneously (the previous behavior)
// risked silently exceeding that — a 429 gets caught inside
// getEventDetails and just resolves to an empty result, not a visible
// error, so rate-limiting could have been quietly suppressing results
// without ever showing up in verifyErrors. Batching at a conservative
// size with a pause between batches keeps this safely under the limit.
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

// Determines which country to actually query. If any enabled provider
// supports pricing for the visitor's real country, uses it as-is. If
// none do (confirmed via Ticketmaster's own documentation: their Price
// Ranges feature only works for US/CA/AU/NZ/MX — Germany, UK, and most
// of the world structurally never return price data through it,
// regardless of query strategy), falls back to a country that SOME
// enabled provider does support, so trending still shows something real
// rather than nothing. Deliberately dynamic, not a hardcoded "Germany
// means US" rule — adding a second provider that covers Germany's
// pricing later means this just starts using the real country
// automatically, no changes needed here.
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
  // No provider offers a fallback either — proceed with the originally
  // requested country anyway; honest, even if it likely yields little.
  return { queryCountry: requestedCountry, usedPricingFallback: false };
}

// Trending concert data doesn't need to be re-fetched fresh on every
// single page load — the discovery+verification pipeline is genuinely
// expensive (a wide discovery fetch plus up to 25 throttled candidate
// lookups, confirmed in practice to take ~10 seconds end to end).
// In-memory only (not persisted across restarts) — a cold cache after a
// deploy just means one slow request, not broken data.
//
// TTL is sized to comfortably outlast a full rotation cycle below (all 5
// countries take ROTATION_COUNT * BACKGROUND_REFRESH_INTERVAL_MS to each
// get touched once) — otherwise a country's cache entry would expire
// between its own refreshes, and visitors would fall back to the slow
// lazy path anyway, defeating the point of pre-warming at all.
const CACHE_TTL_MS = 18 * 60 * 60 * 1000; // 18 hours — see reasoning above
const trendingCache = new Map(); // cacheKey -> { data, expiresAt }

// Proactively refreshes cached trending data on a schedule, so real
// visitors never have to wait for the slow pipeline themselves. Budgeted
// to ~200 Ticketmaster API calls/day total, well under their ~5,000/day
// free-tier quota — refreshing all 5 supported countries every cycle
// (the original design) would have cost ~37,000 calls/day and exhausted
// the quota within about 2 hours, breaking real user searches too, not
// just trending. Rotating through ONE country per cycle instead, at a
// 3-hour interval, costs ~26 calls/cycle × 8 cycles/day ≈ 208/day —
// close to the requested 200/day budget — while still refreshing every
// supported country at least once every 15 hours (comfortably inside
// the 18-hour cache TTL above).
const BACKGROUND_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 hours
let backgroundRefreshRotationIndex = 0;

async function backgroundRefreshTrending() {
  // Re-reads env fresh on every cycle (not captured once at startup) so
  // a Ticketmaster key added later via the admin panel gets picked up
  // without needing a server restart.
  const env = registry.getMergedEnv();
  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');
  if (demoMode) return; // nothing slow to pre-warm — demo mode is always instant, no real API calls involved

  const countriesToWarm = [];
  for (const p of providers) {
    if (Array.isArray(p.pricingSupportedCountries)) {
      p.pricingSupportedCountries.forEach((c) => { if (!countriesToWarm.includes(c)) countriesToWarm.push(c); });
    }
  }
  if (countriesToWarm.length === 0) countriesToWarm.push(FALLBACK_COUNTRY);

  // One country per cycle, rotating — not all of them at once. US (or
  // whichever country a provider lists first) gets warmed on the very
  // first cycle at startup, which matters since that's the fallback
  // target for most visitors whose own country isn't supported.
  const country = countriesToWarm[backgroundRefreshRotationIndex % countriesToWarm.length];
  backgroundRefreshRotationIndex += 1;

  try {
    const { queryCountry, usedPricingFallback } = resolvePricingCountry(providers, country);
    const fresh = await runTrendingPipeline(queryCountry, demoMode, usedPricingFallback, country, providers, env);
    trendingCache.set(`${queryCountry}:real`, { data: fresh, expiresAt: Date.now() + CACHE_TTL_MS });
  } catch (err) {
    // The existing cache entry (if any) just stays as-is until the next
    // time this country comes up in rotation.
    console.warn(`[trending background refresh] failed for ${country}:`, err.message);
  }
}

function startBackgroundTrendingRefresh() {
  // Fire immediately on startup — don't make the very first visitor
  // after a deploy wait a full 5 minutes for a warm cache — then keep
  // refreshing on the regular interval after that.
  backgroundRefreshTrending().catch((err) => console.warn('[trending background refresh]', err.message));
  setInterval(() => {
    backgroundRefreshTrending().catch((err) => console.warn('[trending background refresh]', err.message));
  }, BACKGROUND_REFRESH_INTERVAL_MS);
}

async function getTrendingEvents(clientIp, env, overrideCountry) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  // Diagnostic-only override — lets ?country=GB be tested directly
  // without needing to actually be in that country, specifically to
  // isolate whether zero-priced-results is a Germany-specific data gap
  // or a broader one. Not a real feature, just the fastest way to get a
  // decisive answer after three query-strategy fixes all failed
  // identically for DE.
  const requestedCountry = overrideCountry || detectedCountry || FALLBACK_COUNTRY;

  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  const { queryCountry, usedPricingFallback } = resolvePricingCountry(providers, requestedCountry);
  const countryCode = queryCountry;

  // Cache key includes demoMode so a provider being added/removed while
  // the server is running (e.g. via the admin panel) can't serve stale
  // demo data as if it were real, or vice versa — it just starts a fresh
  // cache entry instead.
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
  // Diagnostic counters — surfaced in the response temporarily so the
  // pipeline's actual behavior can be inspected directly (discovered vs.
  // upcoming vs. candidates checked vs. how many verification calls
  // actually errored vs. how many came back priced), instead of guessing
  // blind from just the final count after two failed fix attempts.
  const debug = { discoveredCount: 0, upcomingCount: 0, candidatesChecked: 0, verifyErrors: 0, verifiedRawCount: 0, eligibleCount: 0 };
  if (usedPricingFallback) {
    debug.pricingFallback = `${requestedCountry} not supported for pricing by any enabled provider — querying ${countryCode} instead`;
  }

  // STEP 1 — Discover: broad country browse, no price required at this
  // stage. Confirmed via direct testing that this query shape (no
  // keyword, country-only) reliably comes back with priceRanges missing
  // on every result, regardless of sort order — so this step exists
  // purely to find out WHAT'S happening, not to get final pricing from.
  // Real evidence (a debug trace showing 2025-dated events while "now"
  // is August 2026) confirmed the query never told Ticketmaster "only
  // from today onward" — sort=date,asc alone just starts from whatever's
  // earliest in their whole database, past events included. Explicit
  // startDateTime fixes this at the query level, not just relying on the
  // client-side isUpcoming() filter to clean up afterward.
  // Set to MIN_LEAD_DAYS out, not just "now" — confirmed via a real
  // debug trace that checking pricing soonest-first (correctly
  // prioritizing near-term events, more likely to be on sale) actively
  // conflicted with the minimum-lead-time requirement: the 6 candidates
  // that DID have real pricing were exactly the ones too soon to be
  // eligible, wasting those verification calls on events that would be
  // rejected anyway. Discovery only returning already-eligible events
  // means every verification call has a real chance of counting.
  //
  // limit raised from 40 to 150 — confirmed via real evidence this fix
  // introduced a NEW problem: sorting date,asc from the lead-time
  // boundary meant all 40 discovered events clustered on that single
  // boundary day (a high-volume market like the US easily has 40+ shows
  // on any given day), leaving the date-spacing logic with no other
  // dates to actually choose from. This is one discovery call, not
  // multiplied per-candidate like verification is, so a much larger
  // fetch here is cheap and gives real date variety to work with.
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
  // Raw date/time as received, before any filtering — the fastest way
  // to see whether isUpcoming is rejecting real future dates due to a
  // parsing issue, versus the discovered events genuinely lacking dates.
  debug.discoveredDateSample = discovered.slice(0, 5).map((ev) => ({ name: ev.name, date: ev.date, time: ev.time }));

  const upcomingDiscovered = discovered.filter(isUpcoming);
  debug.upcomingCount = upcomingDiscovered.length;
  if (upcomingDiscovered.length === 0) {
    return { countryUsed: countryCode, demoMode, count: 0, results: [], debug };
  }

  // Prefer onsale events for candidate selection — an event that isn't
  // onsale yet cannot have pricing, regardless of how it's queried.
  // Falls back to the full upcoming pool if filtering by sale status
  // would leave nothing to check, rather than returning zero outright.
  const onSaleDiscovered = upcomingDiscovered.filter(isOnSaleOrUnknown);
  debug.onSaleCount = onSaleDiscovered.length;
  debug.saleStatusSample = upcomingDiscovered.slice(0, 8).map((ev) => ev.saleStatus);
  const discoveryPool = onSaleDiscovered.length > 0 ? onSaleDiscovered : upcomingDiscovered;

  // Pick candidates to verify pricing for — deliberately soonest-first
  // (not randomized) per the reasoning above: near-term events are more
  // likely to already have on-sale pricing, and discovery is already
  // date-sorted, so preserving that order here matters. Final display
  // selection is still fully randomized (below), just not this stage.
  const candidates = selectDiverseSoonest(discoveryPool, CANDIDATES_TO_VERIFY);
  debug.candidatesChecked = candidates.length;
  // Includes the real Ticketmaster URL now — the fastest way to check
  // whether a price genuinely exists on Ticketmaster's own site for one
  // of these events (a data question, answerable by just looking) versus
  // this API key/account not being entitled to see pricing at all (a
  // permissions question, not fixable by more query changes).
  debug.candidateSample = candidates.slice(0, 5).map((c) => ({ name: c.name, url: c.url }));

  // STEP 2 — Verify pricing: fetch each candidate's full details directly
  // by its real Ticketmaster event ID, instead of re-searching by
  // keyword. Confirmed with real evidence (two markets, both showing
  // confirmed-onsale, well-known artists with zero priced results after
  // a keyword re-search) that the keyword approach doesn't reliably work
  // — this tries the one remaining, genuinely different hypothesis: a
  // get-by-ID detail endpoint returning more complete data than a list/
  // search endpoint, a common REST API pattern. Falls back to the old
  // keyword re-search for any provider without a detail-by-ID method
  // (demo mode, and any future provider that doesn't offer one).
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
    // Each candidate's promise now resolves to an already-flat array of
    // events directly (from either getEventDetails or the flattened
    // fallback search), unlike the old nested-array-of-per-provider-
    // results shape — concat the whole thing at once, not per-item.
    if (outcome.status === 'fulfilled') {
      if (outcome.value.length === 0) candidatesWithNoResult += 1;
      verified = verified.concat(outcome.value);
    } else {
      debug.verifyErrors += 1;
    }
  });
  debug.verifiedRawCount = verified.length;
  // Distinguishes "candidate lookup succeeded but had nothing" from a
  // hard error — a high number here alongside verifyErrors: 0 would
  // suggest rate-limiting or similar silently swallowed inside
  // getEventDetails's own try/catch, not a genuine lack of pricing.
  debug.candidatesWithNoResult = candidatesWithNoResult;

  const eligible = verified.filter(isUpcoming);
  debug.verifiedUpcomingCount = eligible.length; // split from eligibleCount below — isolates whether the date filter or the price filter is the actual bottleneck, if this still doesn't fully solve it
  const priced = eligible.filter(hasRealPrice);
  debug.pricedBeforeLeadTimeFilter = priced.length;
  const withCoordinates = priced.filter(hasCoordinates);
  debug.withCoordinatesCount = withCoordinates.length; // isolates missing-geocoding as a distinct drop reason from missing price, same pattern as the other debug counters here
  const withLeadTime = withCoordinates.filter(hasMinimumLeadTime);
  debug.eligibleCount = withLeadTime.length;
  // Diversity ordering happens first (establishing preference — a
  // different artist per card, whenever the pool allows it), THEN date
  // spacing greedily picks from that preference-ordered list — so the
  // final 6 respect both constraints, not just whichever was applied
  // last. Passing withLeadTime.length (not TARGET_COUNT) to the first
  // call means it reorders the WHOLE pool by diversity preference
  // instead of cutting it down to 6 before spacing gets a chance to work
  // with it.
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
