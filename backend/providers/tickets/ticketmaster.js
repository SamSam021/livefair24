// providers/tickets/ticketmaster.js
//
// Real adapter for the Ticketmaster Discovery API.
// Activates automatically once TICKETMASTER_API_KEY is set — no other code
// needs to change.
//
// IMPORTANT: this was written from documented API conventions, not tested
// against a live key (this sandbox has no outbound network access). Before
// relying on it, hit the endpoint manually once with your key and confirm
// the response shape still matches — API providers do change field names
// over time. Ticketmaster's current docs: https://developer.ticketmaster.com/

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
};
