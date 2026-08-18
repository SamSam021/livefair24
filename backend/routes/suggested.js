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

async function getSuggested(clientIp, env, overrideCountry) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  const countryCode = overrideCountry || detectedCountry || FALLBACK_COUNTRY;

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
    return { countryUsed: countryCode, artists: [], venues: [] };
  }
  if (!Array.isArray(results)) results = [];

  const actGroups = new Map();
  const venueGroups = new Map();
  for (const ev of results) {
    if (ev.name && ev.eventId) {
      const key = ev.attractionId || ev.name;
      if (!actGroups.has(key)) actGroups.set(key, { name: ev.name, count: 0, genreCounts: new Map() });
      const g = actGroups.get(key);
      g.count += 1;
      const genre = ev.genre || 'Other';
      g.genreCounts.set(genre, (g.genreCounts.get(genre) || 0) + 1);
    }
    if (ev.venue) {
      if (!venueGroups.has(ev.venue)) venueGroups.set(ev.venue, { name: ev.venue, count: 0 });
      venueGroups.get(ev.venue).count += 1;
    }
  }

  // Resolve each act's most common genre within its own group (a
  // keyword/attraction match is occasionally impure, same reasoning as
  // the attractionKey grouping elsewhere) and bucket into "Sports" vs
  // everything else.
  const sportsActs = [];
  const otherActs = [];
  for (const g of actGroups.values()) {
    let topGenre = 'Other';
    let topGenreCount = 0;
    for (const [genre, c] of g.genreCounts) {
      if (c > topGenreCount) { topGenre = genre; topGenreCount = c; }
    }
    const entry = { name: g.name, count: g.count, slug: slugify(g.name), category: topGenre };
    (topGenre === 'Sports' ? sportsActs : otherActs).push(entry);
  }
  sportsActs.sort((a, b) => b.count - a.count);
  otherActs.sort((a, b) => b.count - a.count);

  // Genuine mix, with an honest fallback: if one category has zero real
  // results in this market right now, fill entirely from the other
  // rather than leaving empty slots or inventing placeholder cards —
  // matches how every other "no real data" case on this site is
  // handled today.
  let artists;
  if (sportsActs.length === 0) {
    artists = otherActs.slice(0, MAX_SUGGESTIONS_PER_TYPE);
  } else if (otherActs.length === 0) {
    artists = sportsActs.slice(0, MAX_SUGGESTIONS_PER_TYPE);
  } else {
    artists = sportsActs.slice(0, MAX_PER_CATEGORY).concat(otherActs.slice(0, MAX_PER_CATEGORY));
  }

  const venues = [...venueGroups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SUGGESTIONS_PER_TYPE)
    .map((g) => ({ name: g.name, count: g.count, slug: slugify(g.name) }));

  return {
    countryUsed: countryCode,
    artists,
    venues,
  };
}

module.exports = { getSuggested };
