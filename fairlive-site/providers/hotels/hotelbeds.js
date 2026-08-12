// providers/hotels/hotelbeds.js
//
// Real adapter for the Hotelbeds Hotel Booking API. Hotelbeds auth uses a
// signature = SHA256(apiKey + secret + unixTimestamp), sent as a header —
// no OAuth token flow needed.
// Activates once HOTELBEDS_API_KEY and HOTELBEDS_SECRET are both set.
//
// IMPORTANT: written from documented API conventions, not tested against a
// live account in this sandbox (no outbound network access here). Verify
// against https://developer.hotelbeds.com/ before relying on it in
// production — Hotelbeds' search flow (availability -> checkrates -> book)
// is multi-step; this adapter only covers the initial availability/price
// lookup shown in the comparison table.

const https = require('https');
const crypto = require('crypto');

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`Hotelbeds API ${res.statusCode}: ${data.slice(0, 300)}`));
        } catch (e) {
          reject(new Error('Hotelbeds: could not parse response JSON'));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function signature(apiKey, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  return crypto.createHash('sha256').update(apiKey + secret + timestamp).digest('hex');
}

module.exports = {
  id: 'hotelbeds',
  name: 'Hotelbeds',
  requiredEnv: ['HOTELBEDS_API_KEY', 'HOTELBEDS_SECRET'],
  isEnabled(env) {
    return !!(env.HOTELBEDS_API_KEY && env.HOTELBEDS_SECRET);
  },
  async search(params, env) {
    try {
      const apiKey = env.HOTELBEDS_API_KEY;
      const sig = signature(apiKey, env.HOTELBEDS_SECRET);
      const body = JSON.stringify({
        stay: { checkIn: params.checkIn, checkOut: params.checkOut },
        occupancies: [{ rooms: 1, adults: 2, children: 0 }],
        geolocation: { latitude: params.lat, longitude: params.lng, radius: 8, unit: 'km' },
      });
      const data = await httpsRequest(
        {
          hostname: 'api.test.hotelbeds.com', // switch to api.hotelbeds.com for production
          path: '/hotel-api/1.0/hotels',
          method: 'POST',
          headers: {
            'Api-key': apiKey,
            'X-Signature': sig,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body
      );
      const hotels = (data.hotels && data.hotels.hotels) || [];
      return hotels.map((h) => ({
        hotelId: h.code,
        name: h.name,
        pricePerNight: h.minRate ? Number(h.minRate) : null,
        currency: h.currency || 'EUR',
        distanceKm: null, // Hotelbeds returns lat/lng, not pre-computed distance — compute client-side if needed
        rating: h.categoryName ? null : null, // Hotelbeds uses star category, not a review score, here
        reviews: null,
        lat: h.latitude,
        lng: h.longitude,
        url: '#', // booking requires the separate checkrates + booking steps
        demo: false,
      }));
    } catch (err) {
      console.warn('[hotelbeds provider]', err.message);
      return [];
    }
  },
};
