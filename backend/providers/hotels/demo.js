// providers/hotels/demo.js
//
// Reference implementation of the HOTEL PROVIDER interface. Same contract
// idea as providers/tickets/demo.js — every real adapter returns:
//   { hotelId, name, pricePerNight, currency, distanceKm, rating, reviews,
//     lat, lng, url, demo }
// Always enabled as a fallback so the site isn't empty before real hotel
// API keys are added. Results are flagged demo:true.

function seededJitter(seed) {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}

const NAMES = ['Central Hotel', 'Riverside Inn', 'Old Town Suites', 'Skyline Hotel', 'Grand Plaza'];

module.exports = {
  id: 'demo',
  name: 'Demo Hotels',
  requiredEnv: [],
  isEnabled() {
    return true;
  },
  async search(params) {
    const lat = Number(params.lat) || 0;
    const lng = Number(params.lng) || 0;
    const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
    const seed = (params.eventId || 0) * 11 + 3 + hourBucket * 5;
    return NAMES.map((name, i) => {
      const jitter = seededJitter(seed + i);
      const dist = Math.round((0.3 + jitter * 4.5) * 10) / 10;
      const price = Math.round((70 + jitter * 150) / 5) * 5;
      const angle = jitter * Math.PI * 2;
      return {
        hotelId: `demo-${i}`,
        name: `${name} (demo)`,
        pricePerNight: price,
        currency: 'USD',
        distanceKm: dist,
        rating: Math.round((3.6 + jitter * 1.3) * 10) / 10,
        reviews: 80 + Math.round(jitter * 3000),
        lat: lat + Math.cos(angle) * (dist / 111),
        lng: lng + Math.sin(angle) * (dist / 111),
        url: '#',
        demo: true,
      };
    }).sort((a, b) => a.distanceKm - b.distanceKm);
  },
};
