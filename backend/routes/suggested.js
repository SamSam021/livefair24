// routes/suggested.js
//
// GET /api/suggested — powers the homepage's "Suggested" carousel, the
// LiveFair24 equivalent of the pattern observed on TickPick's real
// homepage: cards tagged either "Recent" (the visitor's own browsing
// history — tracked client-side in localStorage, this endpoint has no
// part in that half) or "Near you" (geographic proximity), each showing
// a real, current count, never filler text.
//
// Deliberately does its own broad country search rather than reusing
// routes/trending.js's getTrendingEvents() — that function already
// narrows down to 6 diverse, price-verified events for the homepage's
// main cards, which would mean every artist/venue grouped from it shows
// a count of 1. This does the same broad discovery call trending.js
// uses internally (a size=150 country search) specifically to get
// meaningful, genuinely representative counts.
//
// IMPORTANT — mixing in real sports: db/seed-data/sports.js is fictional
// demo data (its own header comment says so plainly — invented team and
// league names, "no real sports data provider API key" exists). Using it
// here would mean showing fake teams inside a carousel everything else
// on it is real, which is exactly the kind of thing this whole project
// has avoided all day. Instead, this passes allCategories: true (the
// same flag the homepage's search bar uses) to the ticket provider,
// which lifts the classificationName=music restriction — Ticketmaster's
// own real inventory already includes real sports events, and its
// response already carries a genuine category (ev.classifications[0]
// .segment.name, already mapped into the "genre" field), so sports
// suggestions here are exactly as real as the concert ones, from the
// same live source.

const ipapi = require('../providers/geo/ipapi');
const cityImage = require('../providers/geo/cityImage');
const registry = require('../providers/registry');

const FALLBACK_COUNTRY = 'US';
const MAX_SUGGESTIONS_PER_TYPE = 6;
// Splits the artist/act suggestions between the two categories rather
// than a flat top-N-by-count, which could accidentally come back
// single-category if one side has far more raw results than the other
// in a given market — the actual "make sure it doesn't only show one
// category" requirement.
const MAX_PER_CATEGORY = 3;

function slugify(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const { createCache } = require('../lib/simpleCache');
const suggestedCache = createCache();
const SUGGESTED_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, matching trending.js's own cache window

async function getSuggested(clientIp, env, overrideCountry, category) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  const countryCode = overrideCountry || detectedCountry || FALLBACK_COUNTRY;

  // Confirmed real problem this fixes: this whole function — including
  // a size=150 Ticketmaster search — ran fresh on every single request
  // with no caching at all, even though the Suggested carousel loads on
  // every homepage/concerts-page visit. Cached by country+category since
  // those are the only two things that change the output.
  const cacheKey = `${countryCode}:${category || 'mixed'}`;
  const cached = suggestedCache.get(cacheKey);
  if (cached) return cached;

  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  if (!tm || typeof tm.searchEvents !== 'function') {
    return { countryUsed: countryCode, artists: [], venues: [] };
  }

  let results = [];
  try {
    results = await tm.searchEvents({ query: '', city: '', countryCode, limit: 150, allCategories: true }, env);
  } catch (err) {
    console.warn('[suggested]', err.message);
    // Short TTL specifically for this failure path — a 429 here
    // shouldn't cache for the full 5 minutes (needlessly long once the
    // rate limit clears), but should still stop this endpoint from
    // hammering an already-rate-limited Ticketmaster on every single
    // request during an active incident. Same reasoning as
    // providers/geo/ipapi.js's failure-caching.
    const failureResult = { countryUsed: countryCode, artists: [], venues: [] };
    suggestedCache.set(cacheKey, failureResult, 60 * 1000);
    return failureResult;
  }
  if (!Array.isArray(results)) results = [];

  const actGroups = new Map();
  const venueGroups = new Map();
  for (const ev of results) {
    // Requires a genuine attractionId, not just ev.name && ev.eventId —
    // confirmed real case: individual tournament ticket products (e.g.
    // "Grandstand Session 13-Day: Cincinnati Open", one of ~20+
    // separately-named single-session tickets for that tournament) have
    // no shared attractionId tying them to one real, recurring
    // performer/team entity. Without this check, each such one-off
    // session became its own standalone "act" — grouped by literal
    // event title — and got suggested just like a real artist, then
    // 404'd on its own /artists/{slug}/ page because there's no
    // coherent "artist" there to find on a re-search. attractionId is
    // Ticketmaster's own signal that something is a tracked, genuine
    // attraction rather than an ad hoc ticket product.
    if (ev.name && ev.eventId && ev.attractionId) {
      const key = ev.attractionId;
      if (!actGroups.has(key)) actGroups.set(key, { name: ev.name, count: 0, genreCounts: new Map(), imageUrl: null });
      const g = actGroups.get(key);
      g.count += 1;
      const genre = ev.genre || 'Other';
      g.genreCounts.set(genre, (g.genreCounts.get(genre) || 0) + 1);
      // First real image found for this act, kept for the rest of the
      // group — not re-checked per event, since one representative
      // photo per act is all a small suggestion card needs.
      if (!g.imageUrl && ev.imageUrl) g.imageUrl = ev.imageUrl;
    }
    if (ev.venue) {
      // Restricted to Sports/Music for the same reason the act loop
      // below buckets strictly into those two genres: the underlying
      // search above passes allCategories: true (needed to surface
      // real sports results), so `results` also contains comedy shows,
      // museum exhibits, theatre, film, etc. Counting every event's
      // venue unconditionally meant a museum could get suggested as a
      // "venue" here with a real event count, while its own
      // /venues/{slug}/ page (venuePage.js) does a music-only search —
      // finding zero matching events there and 404ing. Confirmed
      // exactly this with "Explorado Abenteuermuseum": it showed up as
      // a suggested venue, then 404'd when visited.
      const venueGenre = ev.genre || 'Other';
      // category === 'music' restricts to Music venues only — used by
      // /concerts/, which must never surface a sports venue. Without
      // this, /concerts/'s Suggested carousel could show a football
      // stadium alongside real concert venues, the exact kind of
      // cross-category leak this whole category param exists to stop.
      const venueGenreOk = category === 'music' ? venueGenre === 'Music' : (venueGenre === 'Sports' || venueGenre === 'Music');
      if (venueGenreOk) {
        if (!venueGroups.has(ev.venue)) venueGroups.set(ev.venue, { name: ev.venue, count: 0, city: ev.city || null, state: ev.state || null });
        venueGroups.get(ev.venue).count += 1;
      }
    }
  }

  // Resolve each act's most common genre within its own group (a
  // keyword/attraction match is occasionally impure, same reasoning as
  // the attractionKey grouping elsewhere) and bucket strictly into
  // "Sports" or "Music" — anything else Ticketmaster's real inventory
  // might include (Arts & Theatre, Film, Miscellaneous...) is dropped
  // entirely here, not lumped in as a third bucket. The homepage is
  // specifically meant to suggest concerts and sports, nothing broader.
  const sportsActs = [];
  const musicActs = [];
  for (const [attractionId, g] of actGroups.entries()) {
    let topGenre = 'Other';
    let topGenreCount = 0;
    for (const [genre, c] of g.genreCounts) {
      if (c > topGenreCount) { topGenre = genre; topGenreCount = c; }
    }
    if (topGenre !== 'Sports' && topGenre !== 'Music') continue;
    // id is Ticketmaster's own attractionId — actGroups is now keyed by
    // it exclusively (see the loop above that builds actGroups), so this
    // is always a real ID, never a name-derived fallback. Threaded
    // through to the frontend so /artists/ links can resolve by ID
    // instead of re-searching by name — see routes/artistPage.js.
    const entry = { id: attractionId, name: g.name, count: g.count, slug: slugify(g.name), category: topGenre, imageUrl: g.imageUrl };
    (topGenre === 'Sports' ? sportsActs : musicActs).push(entry);
  }
  sportsActs.sort((a, b) => b.count - a.count);
  musicActs.sort((a, b) => b.count - a.count);

  // Genuine mix, with an honest fallback: if one category has zero real
  // results in this market right now, fill entirely from the other
  // rather than leaving empty slots or inventing placeholder cards —
  // matches how every other "no real data" case on this site is
  // handled today.
  //
  // category === 'music' overrides all of that and returns music acts
  // only, even if sportsActs has real results — this is what makes
  // /concerts/'s Suggested carousel actually concerts-only rather than
  // just "usually mostly music". Every other caller (the general
  // homepage) keeps the mixed behavior unchanged.
  let artists;
  if (category === 'music') {
    artists = musicActs.slice(0, MAX_SUGGESTIONS_PER_TYPE);
  } else if (sportsActs.length === 0) {
    artists = musicActs.slice(0, MAX_SUGGESTIONS_PER_TYPE);
  } else if (musicActs.length === 0) {
    artists = sportsActs.slice(0, MAX_SUGGESTIONS_PER_TYPE);
  } else {
    artists = sportsActs.slice(0, MAX_PER_CATEGORY).concat(musicActs.slice(0, MAX_PER_CATEGORY));
  }

  const venues = [...venueGroups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SUGGESTIONS_PER_TYPE)
    .map((g) => ({ name: g.name, count: g.count, slug: slugify(g.name), city: g.city, state: g.state }));

  // Ticketmaster's venue objects never carry a photo of their own (see
  // providers/geo/cityImage.js's header comment for the confirmed
  // schema reasoning) — a real photo of the venue's own host city,
  // fetched here rather than left for the client to fetch. Run in
  // parallel since each is an independent lookup; a city with no real
  // Wikipedia photo just resolves to null and that card keeps the pin
  // icon, same as before this existed.
  await Promise.all(
    venues.map(async (v) => {
      v.imageUrl = await cityImage.getCityImageUrl(v.city, v.state);
    })
  );

  const finalResult = {
    countryUsed: countryCode,
    artists,
    venues,
  };
  suggestedCache.set(cacheKey, finalResult, SUGGESTED_CACHE_TTL_MS);
  return finalResult;
}

module.exports = { getSuggested };
