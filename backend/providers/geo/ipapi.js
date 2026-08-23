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

const https = require('https');

// Confirmed real cause of a real reported bug: language auto-detection
// was silently defaulting everyone to English. This function had zero
// caching, and is now called from TWO places per pageview (trending.js's
// country detection, and i18n/detect.js's language detection) — every
// visitor, every page load, was a fresh real ipapi.co call. We already
// confirmed actual 429 rate-limit responses from this exact free-tier
// service earlier — once that limit is hit, every call fails, returns
// null, and null always maps to English regardless of the visitor's
// real country. A simple IP-keyed cache with a 24h TTL (an IP's country
// essentially never changes within a day) cuts real API calls
// dramatically — repeat visits, and different pages loaded by the same
// visitor, now reuse one real lookup instead of triggering a fresh one
// each time.
const COUNTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Failures get a much shorter TTL than successes — long enough to stop
// hammering ipapi.co with doomed requests during an active rate-limit
// window (their limit resets daily, so retrying every request during
// that window is pure waste), short enough that a genuine recovery
// (limit reset, transient network blip) is picked up again within
// minutes rather than staying "unknown" for a full day.
const FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const countryCache = new Map(); // ip -> { countryCode, expiresAt }

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

// Returns an ISO 3166-1 alpha-2 country code (e.g. 'US', 'DE'), or null
// if it couldn't be determined — callers must have a sensible fallback,
// not treat null as an error to surface to the visitor.
async function getCountryCodeForIp(ip) {
  if (isPrivateOrLocalIp(ip)) return null;

  const cached = countryCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.countryCode;
  }

  try {
    const data = await httpGet(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (data.error) {
      countryCache.set(ip, { countryCode: null, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
      return null; // ipapi.co returns {"error":true,"reason":"..."} on failure, not an HTTP error code
    }
    const countryCode = data.country_code || null;
    // Only cache a genuine success at the long TTL — a rate-limited/
    // failed lookup gets the short failure TTL above instead, so the
    // next request for this IP after a real recovery gets a fresh
    // attempt rather than being locked into "unknown" for a full day.
    if (countryCode) {
      countryCache.set(ip, { countryCode, expiresAt: Date.now() + COUNTRY_CACHE_TTL_MS });
    }
    return countryCode;
  } catch (err) {
    console.warn('[ipapi.co geo lookup]', err.message);
    countryCache.set(ip, { countryCode: null, expiresAt: Date.now() + FAILURE_CACHE_TTL_MS });
    return null;
  }
}

module.exports = { getCountryCodeForIp, isPrivateOrLocalIp };
