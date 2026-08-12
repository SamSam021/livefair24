// providers/hotels/amadeus.js
//
// Real adapter for the Amadeus for Developers Hotel Search API.
// Amadeus uses OAuth2 (client credentials) rather than a simple API key —
// this adapter fetches and caches an access token, then calls hotel search.
// Activates once BOTH AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET are set.
//
// IMPORTANT: written from documented API conventions, not tested against a
// live account in this sandbox (no outbound network access here). Verify
// against https://developers.amadeus.com/ before relying on it — endpoint
// paths and response shapes are worth double-checking, and note Amadeus has
// separate "test" and "production" environments with different base URLs.

const https = require('https');

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`Amadeus API ${res.statusCode}: ${data.slice(0, 300)}`));
        } catch (e) {
          reject(new Error('Amadeus: could not parse response JSON'));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken(env) {
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;
  const body = `grant_type=client_credentials&client_id=${env.AMADEUS_CLIENT_ID}&client_secret=${env.AMADEUS_CLIENT_SECRET}`;
  const data = await httpsRequest(
    {
      hostname: 'test.api.amadeus.com', // switch to api.amadeus.com for production access
      path: '/v1/security/oauth2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );
  cachedToken = data.access_token;
  cachedTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

module.exports = {
  id: 'amadeus',
  name: 'Amadeus',
  requiredEnv: ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'],
  isEnabled(env) {
    return !!(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET);
  },
  async search(params, env) {
    try {
      const token = await getAccessToken(env);
      const lat = params.lat, lng = params.lng;
      const path = `/v2/shopping/hotel-offers?latitude=${lat}&longitude=${lng}&radius=8&radiusUnit=KM&checkInDate=${params.checkIn}&checkOutDate=${params.checkOut}`;
      const data = await httpsRequest({
        hostname: 'test.api.amadeus.com',
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const offers = data.data || [];
      return offers.map((o) => {
        const hotel = o.hotel || {};
        const offer = (o.offers && o.offers[0]) || {};
        const price = offer.price || {};
        return {
          hotelId: hotel.hotelId,
          name: hotel.name,
          pricePerNight: Number(price.total) || null,
          currency: price.currency || 'USD',
          distanceKm: hotel.hotelDistance ? hotel.hotelDistance.distance : null,
          rating: hotel.rating ? Number(hotel.rating) : null,
          reviews: null, // not provided by this endpoint
          lat: hotel.latitude,
          lng: hotel.longitude,
          url: '#', // Amadeus hotel-offers requires a separate booking flow via their Booking API
          demo: false,
        };
      });
    } catch (err) {
      console.warn('[amadeus provider]', err.message);
      return [];
    }
  },
};
