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
const cache = new Map();

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
async function getCityImageUrl(cityName, state) {
  if (!cityName) return null;
  const normalizedState = state && state.trim().toLowerCase() !== cityName.trim().toLowerCase() ? state.trim() : null;
  const key = `${cityName.trim().toLowerCase()}|${(normalizedState || '').toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);

  const candidates = [];
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
  cache.set(key, result);
  return result;
}

module.exports = { getCityImageUrl };
