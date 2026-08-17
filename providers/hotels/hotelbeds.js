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

// Diagnostic aid, same pattern used for stayapi.js: captures the real
// reason behind an empty/failed result so it can be surfaced through
// /api/hotels' response (via getLastError()) without needing server log
// access — which turned out to be genuinely hard to get to in practice.
let lastError = null;

// Converts the \n-escaped single-line env var format back into a real
// multi-line PEM string.
function unescapePem(value) {
  return value ? value.replace(/\\n/g, '\n') : value;
}

// Validates a PEM string has real BEGIN/END markers before it's ever
// handed to OpenSSL — a malformed value (most likely from an incomplete
// copy-paste into a single-line admin-panel field, exactly the failure
// mode this project hit twice already while generating these) otherwise
// produces an opaque "no start line" error that doesn't say which of
// the two PEM values (cert vs key) is actually the broken one. This
// catches that and names the specific field and the specific defect.
function validatePem(value, fieldName, expectedBeginLine, expectedEndLine) {
  if (!value) return `${fieldName} is empty`;
  const trimmed = value.trim();
  if (!trimmed.startsWith(expectedBeginLine)) {
    return `${fieldName} doesn't start with "${expectedBeginLine}" — it starts with "${trimmed.slice(0, 40)}..." instead. Likely an incomplete paste (missing the BEGIN line).`;
  }
  if (!trimmed.endsWith(expectedEndLine)) {
    return `${fieldName} doesn't end with "${expectedEndLine}" — it ends with "...${trimmed.slice(-40)}" instead. Likely an incomplete paste (cut off before the END line).`;
  }
  return null;
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
  // Diagnostic-only — see the lastError comment above.
  getLastError() {
    return lastError;
  },
  async search(params, env) {
    let credentialDiagnostic = '';
    try {
      const cert = unescapePem(env.HOTELBEDS_CLIENT_CERT);
      const key = unescapePem(env.HOTELBEDS_CLIENT_KEY);

      // Check both PEM values are actually well-formed BEFORE handing
      // them to OpenSSL — a bad value here otherwise surfaces as an
      // opaque "no start line" error with no indication of which field
      // is the problem.
      const certError = validatePem(cert, 'HOTELBEDS_CLIENT_CERT', '-----BEGIN CERTIFICATE-----', '-----END CERTIFICATE-----');
      const keyError = validatePem(key, 'HOTELBEDS_CLIENT_KEY', '-----BEGIN PRIVATE KEY-----', '-----END PRIVATE KEY-----');
      if (certError || keyError) {
        lastError = [certError, keyError].filter(Boolean).join(' | ');
        console.warn(`[hotelbeds provider] ${lastError}`);
        return [];
      }

      const apiKey = env.HOTELBEDS_API_KEY;
      const secret = env.HOTELBEDS_SECRET;
      const sig = signature(apiKey, secret);
      // Diagnostic breadcrumb for a 401 below: character lengths and
      // whether either value has leading/trailing whitespace — visible
      // without ever exposing the actual key/secret values themselves.
      // Given how many of today's real bugs turned out to be an
      // incomplete copy-paste, this is worth checking directly rather
      // than assuming a "refreshed" credential is actually intact.
      const credentialDiagnostic_local = `apiKey: ${apiKey ? apiKey.length : 0} chars${apiKey !== apiKey.trim() ? ' (has whitespace!)' : ''}, secret: ${secret ? secret.length : 0} chars${secret !== secret.trim() ? ' (has whitespace!)' : ''}`;
      credentialDiagnostic = credentialDiagnostic_local;
      const body = JSON.stringify({
        stay: { checkIn: params.checkIn, checkOut: params.checkOut },
        occupancies: [{ rooms: 1, adults: 2, children: 0 }],
        geolocation: { latitude: params.lat, longitude: params.lng, radius: 8, unit: 'km' },
      });
      const data = await httpsRequest(
        {
          // CONFIRMED from Hotelbeds' own "Mutual Authentication" docs
          // page: their example curl command for an mTLS-authenticated
          // request targets api-mtls.hotelbeds.com specifically — a
          // different host from api.test.hotelbeds.com (which this file
          // was using before, and which is almost certainly why every
          // mTLS-authenticated request so far came back with a signature
          // verification failure despite a valid certificate handshake).
          // Their example still sends Api-key + X-Signature on top of
          // the certificate, confirming both auth layers are meant to
          // combine, not replace each other, as this file already does.
          hostname: 'api-mtls.hotelbeds.com',
          path: '/hotel-api/1.0/hotels',
          method: 'POST',
          // Client certificate + private key for mutual TLS — presented
          // during the HTTPS handshake itself, before any headers are
          // even sent. This is what the original version of this file
          // was missing entirely.
          cert: cert,
          key: key,
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

      // Defensive, same reasoning as the bug just found in stayapi.js:
      // don't assume the documented shape is what actually comes back —
      // check it, and if it's not there, capture exactly what was
      // received instead of crashing or silently returning nothing
      // unexplained.
      if (!data || !data.hotels || !Array.isArray(data.hotels.hotels)) {
        lastError = `search response didn't have the expected hotels.hotels[] shape — full response: ${JSON.stringify(data).slice(0, 400)}`;
        console.warn(`[hotelbeds provider] ${lastError}`);
        return [];
      }
      const hotels = data.hotels.hotels;

      if (hotels.length === 0) {
        lastError = `search succeeded but returned 0 hotels — full response: ${JSON.stringify(data).slice(0, 400)}`;
      } else {
        lastError = null;
      }

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
      const fullMessage = `${err.message} — credentials: ${credentialDiagnostic || 'not reached'}`;
      console.warn('[hotelbeds provider]', fullMessage);
      lastError = fullMessage;
      return [];
    }
  },
};
