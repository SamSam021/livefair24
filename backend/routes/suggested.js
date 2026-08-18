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

const ipapi = require('../providers/geo/ipapi');
const registry = require('../providers/registry');

const FALLBACK_COUNTRY = 'US';
const MAX_SUGGESTIONS_PER_TYPE = 6;

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
    results = await tm.searchEvents({ query: '', city: '', countryCode, limit: 150 }, env);
  } catch (err) {
    console.warn('[suggested]', err.message);
    return { countryUsed: countryCode, artists: [], venues: [] };
  }
  if (!Array.isArray(results)) results = [];

  const artistGroups = new Map();
  const venueGroups = new Map();
  for (const ev of results) {
    if (ev.name && ev.eventId) {
      const key = ev.attractionId || ev.name;
      if (!artistGroups.has(key)) artistGroups.set(key, { name: ev.name, count: 0 });
      artistGroups.get(key).count += 1;
    }
    if (ev.venue) {
      if (!venueGroups.has(ev.venue)) venueGroups.set(ev.venue, { name: ev.venue, count: 0 });
      venueGroups.get(ev.venue).count += 1;
    }
  }

  const toSuggestionList = (groups) =>
    [...groups.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SUGGESTIONS_PER_TYPE)
      .map((g) => ({ name: g.name, count: g.count, slug: slugify(g.name) }));

  return {
    countryUsed: countryCode,
    artists: toSuggestionList(artistGroups),
    venues: toSuggestionList(venueGroups),
  };
}

module.exports = { getSuggested };
