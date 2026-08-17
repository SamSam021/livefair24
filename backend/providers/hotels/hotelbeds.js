// providers/hotels/hotelbeds.js
//
// Real adapter for the Hotelbeds Hotel Booking API. Hotelbeds auth uses a
// signature = SHA256(apiKey + secret + unixTimestamp), sent as a header —
// no OAuth token flow needed.
// Activates once HOTELBEDS_API_KEY and HOTELBEDS_SECRET are both set.
//
// Also requires mutual TLS — confirmed as a real, current requirement from
// Hotelbeds' own documentation (developer.hotelbeds.com, "Mutual
// Authentication"), not something the original version of this file
// implemented at all. Every request now presents a client certificate
// (HOTELBEDS_CLIENT_CERT) signed by Hotelbeds' own CA and its matching
// private key (HOTELBEDS_CLIENT_KEY), on top of the existing Api-key +
// X-Signature headers — both auth layers together, not one replacing the
// other. isEnabled() requires all four env vars for that reason.
//
// Env var format: both HOTELBEDS_CLIENT_CERT and HOTELBEDS_CLIENT_KEY are
// full PEM text (multi-line, starting with "-----BEGIN..."). Since most
// places you'd set an env var (this admin panel included) expect a single
// line, store them with literal \n in place of real line breaks — the
// code below converts \n back into real newlines before use.
//
// IMPORTANT: the request/response shape below (search endpoint, body
// fields, response parsing) is still written from documented API
// conventions, not verified against a live account in this sandbox (no
// outbound network access here) — only the certificate/key pairing
// itself was verified (matched against each other cryptographically).
// Confirm the actual search call against a real account before relying
// on it in production.

const https = require('https');
const crypto = require('crypto');

// Converts the \n-escaped single-line env var format back into a real
// multi-line PEM string.
function unescapePem(value) {
  return value ? value.replace(/\\n/g, '\n') : value;
}

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
  requiredEnv: ['HOTELBEDS_API_KEY', 'HOTELBEDS_SECRET', 'HOTELBEDS_CLIENT_CERT', 'HOTELBEDS_CLIENT_KEY'],
  isEnabled(env) {
    return !!(env.HOTELBEDS_API_KEY && env.HOTELBEDS_SECRET && env.HOTELBEDS_CLIENT_CERT && env.HOTELBEDS_CLIENT_KEY);
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
          // Client certificate + private key for mutual TLS — presented
          // during the HTTPS handshake itself, before any headers are
          // even sent. This is what the original version of this file
          // was missing entirely.
          cert: unescapePem(env.HOTELBEDS_CLIENT_CERT),
          key: unescapePem(env.HOTELBEDS_CLIENT_KEY),
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
