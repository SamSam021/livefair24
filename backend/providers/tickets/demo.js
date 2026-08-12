// providers/tickets/demo.js
//
// This is the reference implementation of the TICKET PROVIDER interface.
// Every real adapter (ticketmaster.js, seatgeek.js, ...) must export the
// same shape:
//
//   id             string   — unique key, used internally
//   name           string   — display name shown on the site
//   badge          string   — 2-letter badge shown in the seller icon
//   requiredEnv    string[] — env var names this provider needs to run
//   isEnabled(env) function — return true if this provider should be used
//   search(params, env) — async function, returns an array of:
//       {
//         sellerId, sellerName, badge,
//         faceValue, fees, total,        // numbers, in the event's currency
//         currency,                      // e.g. 'USD'
//         rating, reviews,               // seller rating shown to users
//         url,                           // where "Get tickets" sends the user
//         section                        // e.g. "Floor · GA Standing"
//       }
//
// This demo provider never needs an API key, so it's always available as a
// fallback — but it is clearly flagged with `demo: true` on every result so
// the frontend can show a "Demo mode" banner instead of silently presenting
// fake prices as if they were live.

function seededJitter(seed) {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}

module.exports = {
  id: 'demo',
  name: 'Demo Seller',
  badge: 'DM',
  requiredEnv: [],
  isEnabled() {
    return true; // always available as a fallback
  },
  async search(params) {
    const base = Number(params.basePrice) || 50;
    // Bucket by hour so demo prices drift slightly over time — this is what
    // lets the price-drop-alert scheduler show a genuine before/after when
    // testing, instead of the same static number forever. A real provider's
    // prices change on their own; this just fakes that for demo purposes.
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const seed = (params.eventId || 0) * 7 + 1 + hourBucket * 3;
    const sellers = [
      { code: 'TN', name: 'TicketNetwork (demo)', mult: 1.0 },
      { code: 'VS', name: 'Vivid Seats (demo)', mult: 1.08 },
      { code: 'TM', name: 'Ticketmaster (demo)', mult: 1.14 },
    ];
    return sellers.map((s, i) => {
      const jitter = seededJitter(seed + i);
      const total = Math.round(base * s.mult * (0.97 + jitter * 0.06) * 100) / 100;
      const fees = Math.round(total * 0.1 * 100) / 100;
      const face = Math.round((total - fees) * 100) / 100;
      return {
        sellerId: `demo-${s.code.toLowerCase()}`,
        sellerName: s.name,
        badge: s.code,
        faceValue: face,
        fees,
        total,
        currency: 'USD',
        rating: Math.round((4.8 - i * 0.2) * 10) / 10,
        reviews: 500 + Math.round(jitter * 4000),
        url: '#',
        section: 'Floor · GA Standing',
        demo: true,
      };
    });
  },

  // Fallback search-by-keyword/city/date when no real provider is
  // configured (or as a supplement) — generates a few plausible,
  // clearly-labeled demo events so /api/search always has something to
  // show, deterministic per query so the same search doesn't jump around
  // on every request.
  async searchEvents(params) {
    const countryCode = (params.countryCode || '').trim();
    const isTrending = !!countryCode && !params.query;
    // For trending (no keyword — "what's popular here"), each demo result
    // needs to be a genuinely different act, not the same placeholder name
    // three times — that broke the real dedup-by-artist logic upstream,
    // which correctly collapsed three identical names down to one.
    const trendingArtists = ['Solene Vale', 'The Amber Room', 'Kite & Compass'];
    const q = (params.query || (isTrending ? '' : 'event')).trim() || 'event';
    const cityFilter = (params.city || '').trim();
    const seed = q.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + countryCode.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0);
    const cities = cityFilter
      ? [{ city: cityFilter, country: '' }]
      : [
          { city: 'Berlin', country: 'Germany' },
          { city: 'London', country: 'United Kingdom' },
          { city: 'Chicago', country: 'United States' },
        ];
    const venues = ['Arena Hall', 'The Grand Theatre', 'Riverside Pavilion'];

    return [0, 1, 2].map((i) => {
      const jitter = seededJitter(seed + i * 13);
      const place = cities[i % cities.length];
      const daysOut = 14 + Math.round(jitter * 60) + i * 9;
      const date = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
      const isoDate = date.toISOString().slice(0, 10);

      // Respect an explicit date range if one was given — demo results
      // outside the requested window are dropped rather than shown as if
      // they matched, same honesty standard as the real providers.
      if (params.dateFrom && isoDate < params.dateFrom.slice(0, 10)) return null;
      if (params.dateTo && isoDate > params.dateTo.slice(0, 10)) return null;

      const displayName = isTrending ? trendingArtists[i] : q;

      return {
        source: 'demo',
        sourceLabel: 'Demo',
        name: `${displayName} (demo)`,
        attractionId: `demo-${i}`, // unique per demo act — mirrors the real attractionId field, keeps dedup-by-artist logic working correctly in demo mode too
        genre: null,
        venue: venues[(seed + i) % venues.length],
        city: place.city,
        country: place.country,
        date: isoDate,
        time: '19:30:00',
        lowestPrice: Math.round((35 + jitter * 90) * 100) / 100,
        currency: 'USD',
        url: '#',
        demo: true,
      };
    }).filter(Boolean);
  },
};
