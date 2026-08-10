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
};
