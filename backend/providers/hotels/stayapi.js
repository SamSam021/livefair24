// providers/hotels/stayapi.js
//
// Real adapter for StayAPI's Booking.com search endpoints
// (https://stayapi.com), used as an alternative to Hotelbeds/Amadeus —
// simple x-api-key header auth, no signature scheme, no mutual TLS.
// Activates once STAYAPI_API_KEY is set.
//
// CONFIRMED against StayAPI's own published docs pages (not tested
// against a live key — no outbound network access in this sandbox —
// but the request/response shapes below are read directly from their
// docs, not guessed):
//
// - GET https://api.stayapi.com/v1/booking/destinations/lookup?query=...
//   Resolves a free-text location name to a dest_id. Response is FLAT —
//   { success, query, normalized_query, dest_id, dest_type, suggestions,
//   message } — dest_id and dest_type are top-level fields, not nested
//   under a "data" array.
//   (docs: https://stayapi.com/docs/endpoints/booking/destinations-lookup)
//
// - GET https://api.stayapi.com/v1/booking/search?dest_id=...&dest_type=...
//   Takes the dest_id (+ dest_type) from the lookup above, not lat/lng.
//   Response: { success, data: [ { hotel_id, hotel_name, url,
//   star_rating, review_score, review_count, address,
//   distance_from_center, min_total_price, currency_code, ... } ] }
//   (docs: https://stayapi.com/docs/endpoints/booking/search)
//   NO per-hotel latitude/longitude here — see MAP_PIN_LIMIT below.
//
// - GET https://api.stayapi.com/v2/booking/hotel/details?hotel_id=...
//   Per-hotel lookup. Response: { success, hotel_id, data: { hotel_name,
//   address, city, country, postal_code, latitude, longitude,
//   star_rating, review_score, review_count, main_photo_url,
//   page_name }, message, retrieved_at }. This IS where per-hotel
//   coordinates live — the search endpoint above doesn't have them.
//   (docs: https://stayapi.com/docs/endpoints/booking/hotel-details)

const https = require('https');

// Map pins cost one extra API request each (a details call per hotel) —
// real quota cost on the 50-request free tier. Capped deliberately
// rather than fetching coordinates for every search result: 1
// destination lookup + 1 search + 10 detail calls = 12 requests per
// page load, not 25+. The remaining hotels beyond this cap still show
// in the list (name, price, rating, distance from city center) — they
// just don't get a map pin, same graceful-omission pattern used
// elsewhere on this site for data we don't have.
const MAP_PIN_LIMIT = 10;

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`StayAPI ${res.statusCode}: ${data.slice(0, 300)}`));
        } catch (e) {
          reject(new Error('StayAPI: could not parse response JSON'));
        }
      });
    }).on('error', reject);
  });
}

// In-memory cache, one process lifetime — avoids spending a
// destination-lookup call (and quota) on the same city more than once
// per server run. Not persisted across restarts; that's fine, it's just
// a call-saving cache, not a source of truth.
const destCache = new Map();

async function resolveDestination(city, apiKey) {
  const key = city.toLowerCase().trim();
  if (destCache.has(key)) return destCache.get(key);

  const url = `https://api.stayapi.com/v1/booking/destinations/lookup?query=${encodeURIComponent(city)}`;
  const data = await httpGet(url, { 'x-api-key': apiKey });
  // Confirmed flat shape — dest_id/dest_type are top-level, not under data[].
  const result = data && data.success && data.dest_id != null
    ? { destId: data.dest_id, destType: data.dest_type || 'CITY' }
    : null;
  destCache.set(key, result);
  return result;
}

// Fetches coordinates for one hotel by ID. Fails soft per-hotel — one
// hotel's details call erroring (rate limit, not found, upstream
// timeout) shouldn't drop coordinates for the other nine.
async function fetchCoordinates(hotelId, apiKey) {
  try {
    const url = `https://api.stayapi.com/v2/booking/hotel/details?hotel_id=${encodeURIComponent(hotelId)}`;
    const data = await httpGet(url, { 'x-api-key': apiKey });
    const d = data && data.data;
    if (!d || d.latitude == null || d.longitude == null) return null;
    return { lat: Number(d.latitude), lng: Number(d.longitude) };
  } catch (err) {
    console.warn(`[stayapi provider] hotel/details failed for hotel_id=${hotelId}:`, err.message);
    return null;
  }
}

module.exports = {
  id: 'stayapi',
  name: 'StayAPI (Booking.com)',
  requiredEnv: ['STAYAPI_API_KEY'],
  isEnabled(env) {
    return !!env.STAYAPI_API_KEY;
  },

  async search(params, env) {
    if (!params.city) {
      console.warn('[stayapi provider] no city provided — this adapter searches by destination, not coordinates alone');
      return [];
    }

    try {
      const apiKey = env.STAYAPI_API_KEY;
      const dest = await resolveDestination(params.city, apiKey);
      if (!dest) {
        console.warn(`[stayapi provider] no destination found for city "${params.city}"`);
        return [];
      }

      const searchParams = new URLSearchParams({
        dest_id: dest.destId,
        dest_type: dest.destType,
        checkin: params.checkIn,
        checkout: params.checkOut,
        adults: '2',
        rooms: '1',
      });
      const url = `https://api.stayapi.com/v1/booking/search?${searchParams}`;
      const data = await httpGet(url, { 'x-api-key': apiKey });
      const hotels = (data && data.data) || [];

      // Fetch coordinates for the top MAP_PIN_LIMIT hotels only, all in
      // parallel (one round trip's worth of latency, not ten sequential
      // ones). Everything beyond the cap keeps lat/lng null.
      const toGeocode = hotels.slice(0, MAP_PIN_LIMIT);
      const coordsList = await Promise.all(
        toGeocode.map((h) => fetchCoordinates(h.hotel_id, apiKey))
      );
      const coordsByHotelId = new Map(
        toGeocode.map((h, i) => [h.hotel_id, coordsList[i]])
      );

      return hotels.map((h) => {
        const coords = coordsByHotelId.get(h.hotel_id) || null;
        return {
          hotelId: h.hotel_id,
          name: h.hotel_name,
          pricePerNight: h.min_total_price != null ? Number(h.min_total_price) : null,
          currency: h.currency_code || 'USD',
          // Distance from Booking's own city-center point, NOT this
          // event's exact venue — the search endpoint doesn't return
          // per-hotel coordinates to compute real venue distance from.
          distanceKm: h.distance_from_center != null ? Number(h.distance_from_center) : null,
          // Booking's review_score is guest satisfaction on a 0–10 scale;
          // normalized to the same 0–5 scale every other rating on this
          // site uses (★ 4.x), so it displays consistently rather than
          // showing an out-of-place "★ 8.7".
          rating: h.review_score != null ? Math.round((h.review_score / 2) * 10) / 10 : null,
          reviews: h.review_count != null ? h.review_count : null,
          lat: coords ? coords.lat : null,
          lng: coords ? coords.lng : null,
          url: h.url || '#',
          demo: false,
        };
      });
    } catch (err) {
      console.warn('[stayapi provider]', err.message);
      return [];
    }
  },
};
