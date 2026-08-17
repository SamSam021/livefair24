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
  try {
    const data = await httpGet(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (data.error) return null; // ipapi.co returns {"error":true,"reason":"..."} on failure, not an HTTP error code
    return data.country_code || null;
  } catch (err) {
    console.warn('[ipapi.co geo lookup]', err.message);
    return null;
  }
}

module.exports = { getCountryCodeForIp, isPrivateOrLocalIp };
