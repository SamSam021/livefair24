// providers/hotels/google-places.js
//
// Real adapter for Google's Places API (New) — Nearby Search, filtered to
// lodging. Used as a stopgap while Hotelbeds' account certification is
// unresolved: genuinely simple self-service (a Google Cloud API key, no
// partner approval, no mutual TLS), but it does NOT provide live prices
// or availability — Google's own hotel pricing/booking API (Travel
// Partner API) is a separate, partner-gated product. This adapter
// returns real hotel names, ratings, and coordinates only.
// Activates once GOOGLE_PLACES_API_KEY is set.
//
// CONFIRMED against Google's own current documentation
// (developers.google.com/maps/documentation/places/web-service/nearby-search),
// not tested against a live key in this sandbox (no outbound network
// access here):
//
// - POST https://places.googleapis.com/v1/places:searchNearby
//   Auth: X-Goog-Api-Key header (plain key, no signature scheme).
//   Requires an X-Goog-FieldMask header listing exactly which fields to
//   return — this is a real Google requirement, not optional, and it's
//   also how their billing tier is determined per field. Fields used
//   below (displayName, formattedAddress, location, id, googleMapsUri)
//   are their lower-cost "Pro" tier; rating + userRatingCount trigger
//   their pricier "Enterprise" tier — included anyway since rating
//   parity with other providers seemed worth the extra cost, but worth
//   knowing if you want to trim it down later.
//   Body: { includedTypes: ["lodging"], maxResultCount, locationRestriction:
//   { circle: { center: {latitude, longitude}, radius } }, rankPreference }
//   Response: { places: [ { id, displayName: {text}, formattedAddress,
//   location: {latitude, longitude}, rating, userRatingCount,
//   googleMapsUri } ] }
//
// NO live price or availability anywhere in this response — Google's own
// docs are explicit that hotel pricing lives in a completely separate,
// partner-gated product (Travel Partner API). pricePerNight is always
// null here; the frontend already handles that gracefully ("Price n/a").

const https = require('https');

let lastError = null;

function httpsPostJson(hostname, path, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, headers),
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
            else reject(new Error(`Google Places API ${res.statusCode}: ${data.slice(0, 300)}`));
          } catch (e) {
            reject(new Error('Google Places API: could not parse response JSON'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Haversine distance, in km — Google's Nearby Search response doesn't
// include a precomputed distance field, but we already have both the
// venue's coordinates (params.lat/lng) and each hotel's real coordinates
// (place.location), so this is computed locally at zero extra API cost,
// rather than left null like it had to be for other providers that
// genuinely don't return per-hotel coordinates at all.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = {
  id: 'google-places',
  name: 'Google Places (listings only, no prices)',
  requiredEnv: ['GOOGLE_PLACES_API_KEY'],
  isEnabled(env) {
    return !!env.GOOGLE_PLACES_API_KEY;
  },
  getLastError() {
    return lastError;
  },
  async search(params, env) {
    if (params.lat == null || params.lng == null) {
      lastError = 'no lat/lng provided';
      return [];
    }
    try {
      const data = await httpsPostJson(
        'places.googleapis.com',
        '/v1/places:searchNearby',
        {
          'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri',
        },
        {
          includedTypes: ['lodging'],
          maxResultCount: 20,
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: {
              center: { latitude: Number(params.lat), longitude: Number(params.lng) },
              radius: 5000, // 5km — reasonable "near this venue" radius
            },
          },
        }
      );

      const places = (data && data.places) || [];
      if (!Array.isArray(places)) {
        lastError = `response's "places" field was not an array — raw response: ${JSON.stringify(data).slice(0, 300)}`;
        return [];
      }
      lastError = places.length === 0 ? `search succeeded but found 0 lodging places nearby` : null;

      return places.map((p) => ({
        hotelId: p.id,
        name: p.displayName ? p.displayName.text : null,
        pricePerNight: null, // genuinely not available from this API — see file header
        currency: null,
        distanceKm:
          p.location && p.location.latitude != null && p.location.longitude != null
            ? Math.round(haversineKm(Number(params.lat), Number(params.lng), p.location.latitude, p.location.longitude) * 10) / 10
            : null,
        rating: p.rating != null ? p.rating : null, // already 0–5, same scale as everywhere else on this site
        reviews: p.userRatingCount != null ? p.userRatingCount : null,
        lat: p.location ? p.location.latitude : null,
        lng: p.location ? p.location.longitude : null,
        url: p.googleMapsUri || '#',
        demo: false,
      }));
    } catch (err) {
      console.warn('[google-places provider]', err.message);
      lastError = err.message;
      return [];
    }
  },
};
