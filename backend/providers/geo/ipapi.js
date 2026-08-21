// providers/geo/ipapi.js
//
// IP -> country lookup, used only to pick which country's trending
// concerts to show on the homepage — never stored, never tied to a
// person, discarded after this one request. Uses ipapi.co's free tier
// (no API key required, ~1,000 requests/day on the free plan as of their
// public docs). If you get real traffic, watch for 429s — you'd need
// either a paid ipapi.co plan or a self-hosted alternative like MaxMind
// GeoLite2.
//
// UNVERIFIED against a live call, same caveat as the original Ticketmaster
// adapter before it was tested — this sandbox has no outbound network
// access. Confirm the response shape below with a real request before
// relying on it in production.
//
// Caching added after a confirmed real incident: this had no caching at
// all, so every single page load needing country detection (homepage,
// suggested, cities) made a fresh ipapi.co call — burning through the
// free tier's daily quota far faster than necessary, since a given IP's
// country is stable for hours, not seconds. Successful lookups cache for
// 6 hours; failures (including 429s) cache for 15 minutes specifically
// so a burst of requests during a rate-limit window doesn't keep hitting
// ipapi.co and making the situation worse — better to fall back to the
// caller's default country for a little while than to keep hammering an
// API that just told us to stop.

const https = require('https');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'livefair24' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('ipapi.co: could not parse response JSON'));
          }
        } else {
          reject(new Error(`ipapi.co returned ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

// Local/private IPs (localhost, testing, behind a LAN) have no real
// geolocation — calling the API with these wastes a request and always
// fails. Caught here so the caller can fall back immediately.
function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  return (
    ip === '127.0.0.1' || ip === '::1' ||
    ip.startsWith('10.') || ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FAILURE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map(); // ip -> { countryCode, expiresAt }

// Returns an ISO 3166-1 alpha-2 country code (e.g. 'US', 'DE'), or null
// if it couldn't be determined — callers must have a sensible fallback,
// not treat null as an error to surface to the visitor.
async function getCountryCodeForIp(ip) {
  if (isPrivateOrLocalIp(ip)) return null;

  const cached = cache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.countryCode;

  let result = null;
  try {
    const data = await httpGet(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (data.error) {
      result = null; // ipapi.co returns {"error":true,"reason":"..."} on failure, not an HTTP error code
    } else {
      result = data.country_code || null;
    }
    cache.set(ip, { countryCode: result, expiresAt: Date.now() + SUCCESS_TTL_MS });
  } catch (err) {
    console.warn('[ipapi.co geo lookup]', err.message);
    result = null;
    // Shorter TTL specifically for failures — see header comment. A 429
    // here shouldn't cache for the full 6 hours (that's needlessly long
    // once the rate limit clears), but also shouldn't retry on every
    // single request during an active rate-limit window.
    cache.set(ip, { countryCode: null, expiresAt: Date.now() + FAILURE_TTL_MS });
  }
  return result;
}

module.exports = { getCountryCodeForIp, isPrivateOrLocalIp };
