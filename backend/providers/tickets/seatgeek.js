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
  // UNVERIFIED — SeatGeek's actual country/pricing coverage hasn't been
  // confirmed against a live response (this provider isn't configured
  // yet). Set conservatively based on SeatGeek being a primarily US/
  // Canada-focused platform; confirm and adjust this list once
  // SEATGEEK_CLIENT_ID is actually set and testable.
  pricingSupportedCountries: ['US', 'CA'],
  isCountrySupportedForPricing(countryCode) {
    return this.pricingSupportedCountries.includes(countryCode);
  },
  getFallbackPricingCountry() {
    return 'US';
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
  // NOTE: unlike the Ticketmaster version, none of this (including the
  // city/date params) has been verified against a real SeatGeek key/
  // response yet — same caveat as search() above. Confirm the field names
  // below against a live response before relying on it.
  async searchEvents(params, env) {
    const clientId = env.SEATGEEK_CLIENT_ID;
    const parts = [`client_id=${clientId}`, 'per_page=10'];
    if (params.query) parts.push(`q=${encodeURIComponent(params.query)}`);
    if (params.city) parts.push(`venue.city=${encodeURIComponent(params.city)}`);
    if (params.countryCode) parts.push(`venue.country=${encodeURIComponent(params.countryCode)}`);
    if (params.dateFrom) parts.push(`datetime_local.gte=${encodeURIComponent(params.dateFrom)}`);
    if (params.dateTo) parts.push(`datetime_local.lte=${encodeURIComponent(params.dateTo)}`);
    // Same reasoning as ticketmaster.js's classificationName=music: this
    // site is concerts only — sports has its own separate DB-backed
    // system — so an unfiltered city/keyword search here could surface a
    // sports match or theater show alongside real concerts. SeatGeek's
    // documented taxonomy field for this is taxonomies.name, "concert"
    // being their concert category — UNVERIFIED against a live SeatGeek
    // key/response like the rest of this file; confirm before relying on
    // it, and adjust the value here if it doesn't match their real API.
    parts.push('taxonomies.name=concert');
    const url = `https://api.seatgeek.com/2/events?${parts.join('&')}`;

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
