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

// How many discovered candidates to re-check for real pricing. Higher
// means a better chance of finding TARGET_COUNT priced events, at the
// cost of more provider API calls (each candidate is one extra request,
// subject to Ticketmaster's rate limit). 15 is a middle ground — kept as
// a named constant so it's easy to tune if it proves too low or too
// costly in practice.
const CANDIDATES_TO_VERIFY = 15;

async function getTrendingEvents(clientIp, env) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  const countryCode = detectedCountry || FALLBACK_COUNTRY;

  const providers = registry.getEnabledTicketProviders(env);
  const demoMode = providers.every((p) => p.id === 'demo');

  // Diagnostic counters — surfaced in the response temporarily so the
  // pipeline's actual behavior can be inspected directly (discovered vs.
  // upcoming vs. candidates checked vs. how many verification calls
  // actually errored vs. how many came back priced), instead of guessing
  // blind from just the final count after two failed fix attempts.
  const debug = { discoveredCount: 0, upcomingCount: 0, candidatesChecked: 0, verifyErrors: 0, verifiedRawCount: 0, eligibleCount: 0 };

  // STEP 1 — Discover: broad country browse, no price required at this
  // stage. Confirmed via direct testing that this query shape (no
  // keyword, country-only) reliably comes back with priceRanges missing
  // on every result, regardless of sort order — so this step exists
  // purely to find out WHAT'S happening, not to get final pricing from.
  const discoverySettled = await Promise.allSettled(
    providers.map((p) =>
      typeof p.searchEvents === 'function'
        ? p.searchEvents({ query: '', city: '', countryCode, limit: 40 }, env)
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

  const upcomingDiscovered = discovered.filter(isUpcoming);
  debug.upcomingCount = upcomingDiscovered.length;
  if (upcomingDiscovered.length === 0) {
    return { detectedCountry, countryUsed: countryCode, demoMode, count: 0, results: [], debug };
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
  debug.candidateNames = candidates.slice(0, 5).map((c) => c.name); // sample, not the full list

  // STEP 2 — Verify pricing: re-query each candidate BY NAME. This is
  // the same query shape /api/search and /api/tickets already use for
  // real, user-initiated searches, and the only one directly confirmed
  // (via a real captured response earlier in this project) to include
  // priceRanges data at least some of the time. Demo mode never reaches
  // this step with an empty query in practice, but is unaffected either
  // way — demo.js always returns priced results.
  const verifySettled = await Promise.allSettled(
    candidates.map((cand) =>
      Promise.all(
        providers.map((p) =>
          typeof p.searchEvents === 'function'
            ? p.searchEvents({ query: cand.name, city: cand.city, countryCode }, env)
            : Promise.resolve([])
        )
      )
    )
  );
  let verified = [];
  verifySettled.forEach((outcome) => {
    if (outcome.status === 'fulfilled') outcome.value.forEach((providerResults) => { verified = verified.concat(providerResults); });
    else debug.verifyErrors += 1;
  });
  debug.verifiedRawCount = verified.length;

  const eligible = verified.filter(isUpcoming);
  debug.verifiedUpcomingCount = eligible.length; // split from eligibleCount below — isolates whether the date filter or the price filter is the actual bottleneck, if this still doesn't fully solve it
  const priced = eligible.filter(hasRealPrice);
  debug.eligibleCount = priced.length;
  const selected = selectDiverseRandom(priced, TARGET_COUNT);

  return {
    detectedCountry: detectedCountry, // null if geolocation didn't resolve — distinct from the fallback actually used
    countryUsed: countryCode,
    demoMode,
    count: selected.length,
    results: selected,
    debug,
  };
}

module.exports = { getTrendingEvents, FALLBACK_COUNTRY };
