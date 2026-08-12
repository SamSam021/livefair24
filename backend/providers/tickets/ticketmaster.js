// providers/tickets/ticketmaster.js
//
// Real adapter for the Ticketmaster Discovery API.
// Activates automatically once TICKETMASTER_API_KEY is set — no other code
// needs to change.
//
// VERIFIED against a real live key and real responses (August 2026) — the
// field shapes below (_embedded.events, dates.start.localDate,
// priceRanges[0].min, _embedded.venues[0].city.name, etc.) are confirmed
// correct, not just documented conventions. The one earlier mystery this
// surfaced: Ticketmaster's `city` filter is an EXACT string match against
// their internal venue city field (e.g. "Brooklyn" ≠ "New York" even
// though it's NYC) — don't assume metro-area matching.

const https = require('https');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Ticketmaster: could not parse response JSON'));
          }
        } else {
          reject(new Error(`Ticketmaster API returned ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    }).on('error', reject);
  });
}

module.exports = {
  id: 'ticketmaster',
  name: 'Ticketmaster',
  badge: 'TM',
  requiredEnv: ['TICKETMASTER_API_KEY'],
  isEnabled(env) {
    return !!env.TICKETMASTER_API_KEY;
  },

  // Used by /api/tickets — price comparison for ONE already-known event
  // (every result here is treated as a competing seller for that event).
  async search(params, env) {
    const key = env.TICKETMASTER_API_KEY;
    const keyword = encodeURIComponent(params.artist || params.query || '');
    const city = params.city ? `&city=${encodeURIComponent(params.city)}` : '';
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&keyword=${keyword}${city}&size=5`;

    try {
      const data = await httpGet(url);
      const events = (data._embedded && data._embedded.events) || [];
      const results = [];
      for (const ev of events) {
        const range = (ev.priceRanges && ev.priceRanges[0]) || null;
        if (!range) continue; // Ticketmaster doesn't always return prices for an event
        const total = Math.round(range.min * 100) / 100;
        const fees = Math.round(total * 0.15 * 100) / 100; // TM doesn't break out fees in this endpoint — estimate; refine if you get access to a fees-inclusive field
        results.push({
          sellerId: 'ticketmaster',
          sellerName: 'Ticketmaster',
          badge: 'TM',
          faceValue: Math.round((total - fees) * 100) / 100,
          fees,
          total,
          currency: range.currency || 'USD',
          rating: null, // Ticketmaster's public API doesn't expose a seller rating
          reviews: null,
          url: ev.url || '#',
          section: 'See seller for section/row',
          demo: false,
        });
      }
      return results;
    } catch (err) {
      console.warn('[ticketmaster provider]', err.message);
      return []; // fail soft — one provider erroring shouldn't break the whole comparison
    }
  },

  // Used by /api/search — find MULTIPLE matching events for a free-text
  // query (each result is a distinct event, not a competing seller for one
  // event). This is the shape a real search feature needs.
  async searchEvents(queryText, env) {
    const key = env.TICKETMASTER_API_KEY;
    const keyword = encodeURIComponent(queryText || '');
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&keyword=${keyword}&size=10`;

    try {
      const data = await httpGet(url);
      const events = (data._embedded && data._embedded.events) || [];
      return events.map((ev) => {
        const range = (ev.priceRanges && ev.priceRanges[0]) || null;
        const venue = (ev._embedded && ev._embedded.venues && ev._embedded.venues[0]) || null;
        const genre = (ev.classifications && ev.classifications[0] && ev.classifications[0].segment) || null;
        return {
          source: 'ticketmaster',
          sourceLabel: 'Ticketmaster',
          name: ev.name,
          genre: genre ? genre.name : null,
          venue: venue ? venue.name : null,
          city: venue && venue.city ? venue.city.name : null,
          country: venue && venue.country ? venue.country.name : null,
          date: ev.dates && ev.dates.start ? ev.dates.start.localDate : null,
          time: ev.dates && ev.dates.start ? ev.dates.start.localTime : null,
          lowestPrice: range ? range.min : null,
          currency: range ? range.currency : null,
          url: ev.url || '#',
        };
      });
    } catch (err) {
      console.warn('[ticketmaster provider] searchEvents', err.message);
      return [];
    }
  },
};
