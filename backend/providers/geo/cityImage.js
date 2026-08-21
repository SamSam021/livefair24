// providers/geo/cityImage.js
//
// Generic city photo lookup — used ONLY as an explicit, site-owner-
// approved stand-in for venue cards on the Suggested carousel (see
// routes/suggested.js and routes/venuePage.js) when Ticketmaster
// itself has no venue photo. Confirmed against Ticketmaster's real
// Discovery API schema: venue objects carry name/address/city/
// country/location/timezone, but no images field at all — only event
// and attraction objects do. So a venue can never get a real
// Ticketmaster photo, only its host city can.
//
// This is a deliberate, flagged exception to this project's "never a
// placeholder/stock photo" pattern used everywhere else on the site —
// a real, sourced photo of the actual city (not a generic stock
// library shot, and not the venue itself) rather than always falling
// back to the plain pin icon. The trade-off was explained to the site
// owner directly before building this: it's the first image on the
// site that isn't literally a photo of the specific thing the card
// represents.
//
// Uses Wikipedia's public "page images" API — no key required, free,
// subject only to Wikimedia's usage policy (identify via User-Agent,
// keep volume reasonable). Returns the real lead photo from the
// city's own Wikipedia article, or null if that city has no article
// or no lead image — never a fabricated fallback image.
//
// UNVERIFIED against a live call, same caveat as ipapi.js — this
// sandbox has no outbound network access. Confirm the response shape
// below with a real request before relying on it in production.

const https = require('https');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'livefair24 (contact: admin@livefair24.com)' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Wikipedia pageimages: could not parse response JSON'));
            }
          } else {
            reject(new Error(`Wikipedia pageimages returned ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      })
      .on('error', reject);
  });
}

// In-memory only, per server process — city photos don't change
// request to request, and this can get called once per suggested
// venue plus once per recently-viewed venue-page visit, so this
// avoids re-hitting Wikipedia for the same city repeatedly during one
// server's uptime. Doesn't persist across restarts; refills lazily,
// which is fine for this.
//
// Successful lookups are cached indefinitely (value: the URL string).
// FAILED lookups (value: null) are cached only briefly — confirmed real
// bug: caching a null result forever meant one transient Wikipedia
// hiccup (all cities for a country fire simultaneously via Promise.all
// in routes/cities.js, so a burst rate-limit response is plausible) put
// that city's image out for the rest of the server's uptime, with no
// way to recover short of a restart. A short retry window fixes that
// without hammering Wikipedia for a city that genuinely has no article.
const cache = new Map(); // key -> { value, expiresAt } — expiresAt is Infinity for successful lookups
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchThumbnail(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=400&redirects=1&titles=${encodeURIComponent(title)}`;
  const data = await httpGet(url);
  const pages = data && data.query && data.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  return page && page.thumbnail && page.thumbnail.source ? page.thumbnail.source : null;
}

// city alone is frequently ambiguous — confirmed with a real case:
// "Lafayette" (Ticketmaster's bare venue.city.name for Blue Moon
// Saloon) matches at least four real US cities (Louisiana, Indiana,
// California, Colorado) plus the historical Marquis de Lafayette,
// so the plain title on Wikipedia resolves to a disambiguation page
// or the wrong article — either way, no usable city photo, even
// though "Lafayette, Louisiana" specifically has one. state (now
// threaded through from Ticketmaster's venue.state.name — see
// providers/tickets/ticketmaster.js) disambiguates the same way
// Wikipedia's own city article titles are conventionally formatted
// ("City, State"), so that's tried first; the bare city name is
// still tried as a fallback for places where state is unavailable
// (most countries outside the US) or where "City, State" isn't
// actually the article's title.
//
// wikiTitleOverride handles the OTHER real failure mode confirmed on
// /api/cities: a bare city name that isn't actually ambiguous but
// still doesn't resolve to the city article, because something else
// owns that exact title on Wikipedia — "New York" alone is the STATE
// article (the city's real title is "New York City"), so the old
// state-based guess never even applied (major-cities.js's US entries
// carry no per-city state) and every visitor got a blank card for the
// single most recognizable US city on the list. Takes priority over
// state-guessing when supplied, since it's a known-correct title, not
// a guess.
async function getCityImageUrl(cityName, state, wikiTitleOverride) {
  if (!cityName) return null;
  const normalizedState = state && state.trim().toLowerCase() !== cityName.trim().toLowerCase() ? state.trim() : null;
  const key = `${cityName.trim().toLowerCase()}|${(normalizedState || '').toLowerCase()}|${(wikiTitleOverride || '').toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const candidates = [];
  if (wikiTitleOverride) candidates.push(wikiTitleOverride);
  if (normalizedState) candidates.push(`${cityName}, ${normalizedState}`);
  candidates.push(cityName);

  let result = null;
  for (const title of candidates) {
    try {
      result = await fetchThumbnail(title);
    } catch (err) {
      console.warn('[cityImage]', err.message);
      result = null;
    }
    if (result) break;
  }
  cache.set(key, { value: result, expiresAt: result ? Infinity : Date.now() + NEGATIVE_CACHE_TTL_MS });
  return result;
}

module.exports = { getCityImageUrl };
