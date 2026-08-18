// providers/genericAdapter.js
//
// Lets a provider registered through the admin panel (with no dedicated
// adapter file) actually return results, for simple REST APIs that take a
// query string and return JSON. This is a best-effort connector — it
// covers "GET a URL with an API key and a search term, get back a JSON
// array" APIs. It does NOT cover OAuth flows, multi-step booking APIs, or
// unusual auth schemes (see Amadeus/Hotelbeds for examples of that kind of
// provider, which need a real adapter file instead).
//
// A custom provider definition (stored via the admin panel) looks like:
//   {
//     id, name, category: 'ticket' | 'hotel', enabled,
//     baseUrl, apiKey,
//     authType: 'query' | 'header',
//     apiKeyParam,      // query param name (if authType='query'), e.g. "api_key"
//     headerName,       // header name (if authType='header'), e.g. "Authorization"
//     queryParam,       // query param name to send the search term under, e.g. "q"
//     itemsPath,        // dot-path to the results array in the JSON response, e.g. "data.events"
//     fields: { name, price, url, rating, distanceKm }  // dot-paths within each item
//   }

const http = require('http');
const https = require('https');
const { URL } = require('url');

function getByPath(obj, dotPath) {
  if (!dotPath) return undefined;
  return dotPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function fetchJSON(urlStr, headers) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(new Error('Invalid URL: ' + urlStr));
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    lib
      .get(urlStr, { headers }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Custom provider: response was not valid JSON'));
            }
          } else {
            reject(new Error(`Custom provider returned ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      })
      .on('error', reject);
  });
}

function buildUrl(def, searchTerm) {
  const url = new URL(def.baseUrl);
  if (def.authType !== 'header' && def.apiKeyParam) url.searchParams.set(def.apiKeyParam, def.apiKey);
  if (def.queryParam && searchTerm) url.searchParams.set(def.queryParam, searchTerm);
  return url.toString();
}

async function genericTicketSearch(def, params) {
  try {
    const url = buildUrl(def, params.artist || params.query || '');
    const headers = {};
    if (def.authType === 'header' && def.headerName) headers[def.headerName] = def.apiKey;
    const data = await fetchJSON(url, headers);
    const items = getByPath(data, def.itemsPath) || [];
    if (!Array.isArray(items)) return [];

    return items
      .map((item) => {
        const total = Number(getByPath(item, def.fields.price));
        if (!total) return null;
        return {
          sellerId: def.id,
          sellerName: def.name,
          badge: (def.name || '??').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || '??',
          faceValue: total, // fee breakdown unknown for a generic connector — show total as face value
          fees: 0,
          total,
          currency: def.currency || 'USD',
          rating: def.fields.rating ? Number(getByPath(item, def.fields.rating)) || null : null,
          reviews: null,
          url: getByPath(item, def.fields.url) || def.baseUrl,
          section: 'See seller for details',
          demo: false,
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`[custom ticket provider: ${def.name}]`, err.message);
    return [];
  }
}

async function genericHotelSearch(def, params) {
  try {
    const url = buildUrl(def, params.query || '');
    const headers = {};
    if (def.authType === 'header' && def.headerName) headers[def.headerName] = def.apiKey;
    const data = await fetchJSON(url, headers);
    const items = getByPath(data, def.itemsPath) || [];
    if (!Array.isArray(items)) return [];

    return items
      .map((item) => {
        const price = Number(getByPath(item, def.fields.price));
        if (!price) return null;
        return {
          hotelId: `${def.id}-${getByPath(item, def.fields.name) || Math.random()}`,
          name: getByPath(item, def.fields.name) || def.name,
          pricePerNight: price,
          currency: def.currency || 'USD',
          distanceKm: def.fields.distanceKm ? Number(getByPath(item, def.fields.distanceKm)) || null : null,
          rating: def.fields.rating ? Number(getByPath(item, def.fields.rating)) || null : null,
          reviews: null,
          lat: def.fields.lat ? Number(getByPath(item, def.fields.lat)) || null : null,
          lng: def.fields.lng ? Number(getByPath(item, def.fields.lng)) || null : null,
          url: getByPath(item, def.fields.url) || def.baseUrl,
          demo: false,
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn(`[custom hotel provider: ${def.name}]`, err.message);
    return [];
  }
}

module.exports = { genericTicketSearch, genericHotelSearch };
