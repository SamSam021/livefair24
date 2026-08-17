// data/major-cities.js
//
// Curated 6-major-cities list per country, used by /api/cities to power
// the "Browse concerts by cities" page. Deliberately a fixed editorial
// list (not derived from live event data) — the whole point is a stable,
// recognizable set of cities for a visitor's country every time they
// land on the page, not a list that reshuffles depending on which cities
// happen to have a show on sale today.
//
// `slug` is only meaningful for cities that have a real dedicated page
// under /cities/<country>/<slug>.html — routes/cities.js falls back to
// linking a city without one straight to a pre-filtered search instead
// of a dead link.

const MAJOR_CITIES = {
  DE: {
    countryName: 'Germany',
    flag: '🇩🇪',
    cities: [
      { name: 'Berlin', slug: 'berlin' },
      { name: 'Hamburg' },
      { name: 'Munich' },
      { name: 'Cologne' },
      { name: 'Frankfurt' },
      { name: 'Düsseldorf' },
    ],
  },
  US: {
    countryName: 'United States',
    flag: '🇺🇸',
    cities: [
      { name: 'New York' },
      { name: 'Los Angeles' },
      { name: 'Chicago' },
      { name: 'Houston' },
      { name: 'Miami' },
      { name: 'San Francisco' },
    ],
  },
  GB: {
    countryName: 'United Kingdom',
    flag: '🇬🇧',
    cities: [
      { name: 'London' },
      { name: 'Manchester' },
      { name: 'Birmingham' },
      { name: 'Glasgow' },
      { name: 'Liverpool' },
      { name: 'Leeds' },
    ],
  },
  IE: {
    countryName: 'Ireland',
    flag: '🇮🇪',
    cities: [
      { name: 'Dublin' },
      { name: 'Cork' },
      { name: 'Limerick' },
      { name: 'Galway' },
      { name: 'Waterford' },
      { name: 'Drogheda' },
    ],
  },
  IT: {
    countryName: 'Italy',
    flag: '🇮🇹',
    cities: [
      { name: 'Milan' },
      { name: 'Rome' },
      { name: 'Naples' },
      { name: 'Turin' },
      { name: 'Bologna' },
      { name: 'Florence' },
    ],
  },
  FR: {
    countryName: 'France',
    flag: '🇫🇷',
    cities: [
      { name: 'Paris' },
      { name: 'Marseille' },
      { name: 'Lyon' },
      { name: 'Toulouse' },
      { name: 'Nice' },
      { name: 'Nantes' },
    ],
  },
};

// Same reasoning as trending.js's FALLBACK_COUNTRY — showing something
// recognizable beats showing nothing when geolocation fails or the
// visitor's country isn't in the curated list yet.
const FALLBACK_COUNTRY = 'US';

function getMajorCitiesForCountry(countryCode) {
  const entry = MAJOR_CITIES[countryCode] || MAJOR_CITIES[FALLBACK_COUNTRY];
  const resolvedCode = MAJOR_CITIES[countryCode] ? countryCode : FALLBACK_COUNTRY;
  return { countryCode: resolvedCode, ...entry };
}

module.exports = { MAJOR_CITIES, FALLBACK_COUNTRY, getMajorCitiesForCountry };
