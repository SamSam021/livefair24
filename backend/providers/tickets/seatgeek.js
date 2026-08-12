// providers/tickets/seatgeek.js
//
// Real adapter for the SeatGeek Platform API.
// Activates automatically once SEATGEEK_CLIENT_ID is set.
//
// IMPORTANT: same caveat as ticketmaster.js — written from documented API
// conventions, not tested against a live key in this sandbox. Verify against
// https://platform.seatgeek.com/ before depending on it in production.

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
            reject(new Error('SeatGeek: could not parse response JSON'));
          }
        } else {
          reject(new Error(`SeatGeek API returned ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    }).on('error', reject);
  });
}

module.exports = {
  id: 'seatgeek',
  name: 'SeatGeek',
  badge: 'SG',
  requiredEnv: ['SEATGEEK_CLIENT_ID'],
  isEnabled(env) {
    return !!env.SEATGEEK_CLIENT_ID;
  },
  async search(params, env) {
    const clientId = env.SEATGEEK_CLIENT_ID;
    const q = encodeURIComponent(params.artist || params.query || '');
    const url = `https://api.seatgeek.com/2/events?client_id=${clientId}&q=${q}&per_page=5`;

    try {
      const data = await httpGet(url);
      const events = data.events || [];
      const results = [];
      for (const ev of events) {
        const low = ev.stats && ev.stats.lowest_price;
        if (!low) continue;
        const total = Math.round(low * 100) / 100;
        const fees = Math.round(total * 0.12 * 100) / 100; // estimate — SeatGeek's fee breakdown requires the checkout step, not exposed in search results
        results.push({
          sellerId: 'seatgeek',
          sellerName: 'SeatGeek',
          badge: 'SG',
          faceValue: Math.round((total - fees) * 100) / 100,
          fees,
          total,
          currency: 'USD',
          rating: ev.score ? Math.round(ev.score * 5 * 10) / 10 : null,
          reviews: null,
          url: ev.url || '#',
          section: 'See seller for section/row',
          demo: false,
        });
      }
      return results;
    } catch (err) {
      console.warn('[seatgeek provider]', err.message);
      return [];
    }
  },

  // Used by /api/search — same purpose as ticketmaster.js's searchEvents:
  // find MULTIPLE matching events, one result per event, not per seller.
  // NOTE: unlike the Ticketmaster version, this hasn't been verified
  // against a real SeatGeek key/response yet — same caveat as search()
  // above. Confirm the field names below against a live response before
  // relying on it.
  async searchEvents(queryText, env) {
    const clientId = env.SEATGEEK_CLIENT_ID;
    const q = encodeURIComponent(queryText || '');
    const url = `https://api.seatgeek.com/2/events?client_id=${clientId}&q=${q}&per_page=10`;

    try {
      const data = await httpGet(url);
      const events = data.events || [];
      return events.map((ev) => ({
        source: 'seatgeek',
        sourceLabel: 'SeatGeek',
        name: ev.title || ev.short_title || null,
        genre: (ev.type || null),
        venue: ev.venue ? ev.venue.name : null,
        city: ev.venue ? ev.venue.city : null,
        country: ev.venue ? ev.venue.country : null,
        date: ev.datetime_local ? ev.datetime_local.slice(0, 10) : null,
        time: ev.datetime_local ? ev.datetime_local.slice(11, 19) : null,
        lowestPrice: ev.stats ? ev.stats.lowest_price : null,
        currency: 'USD',
        url: ev.url || '#',
      }));
    } catch (err) {
      console.warn('[seatgeek provider] searchEvents', err.message);
      return [];
    }
  },
};
