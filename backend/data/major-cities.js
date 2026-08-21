// data/major-cities.js
//
// Curated major-cities list per country, used by /api/cities to power
// the "Browse concerts by cities" page. Deliberately a fixed editorial
// list (not derived from live event data) — the whole point is a stable,
// recognizable set of cities for a visitor's country every time they
// land on the page, not a list that reshuffles depending on which cities
// happen to have a show on sale today. 12 per country (rather than the
// original 6) so the homepage carousel has enough real cities to
// actually be worth scrolling through.
//
// `slug` is only meaningful for cities that have a real dedicated page
// under /cities/<country>/<slug>.html — routes/cities.js falls back to
// linking a city without one straight to a pre-filtered search instead
// of a dead link.
//
// `wikiTitle` is only set where the plain `name` is confirmed NOT to
// resolve to the city's own Wikipedia article (e.g. "New York" alone is
// the STATE article, not the city) — see providers/geo/cityImage.js's
// getCityImageUrl for how it's used. Omit it for every city where the
// bare name already works.

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
      { name: 'Stuttgart' },
      { name: 'Leipzig' },
      { name: 'Dortmund' },
      { name: 'Essen' },
      { name: 'Bremen' },
      { name: 'Dresden' },
    ],
  },
  US: {
    countryName: 'United States',
    flag: '🇺🇸',
    cities: [
      { name: 'New York', wikiTitle: 'New York City' },
      { name: 'Los Angeles' },
      { name: 'Chicago' },
      { name: 'Houston' },
      { name: 'Miami' },
      { name: 'San Francisco' },
      { name: 'Las Vegas' },
      { name: 'Boston' },
      { name: 'Seattle' },
      { name: 'Austin' },
      { name: 'Nashville' },
      { name: 'Atlanta' },
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
      { name: 'Edinburgh' },
      { name: 'Bristol' },
      { name: 'Sheffield' },
      { name: 'Newcastle' },
      { name: 'Cardiff' },
      { name: 'Belfast' },
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
      { name: 'Dundalk' },
      { name: 'Swords' },
      { name: 'Bray' },
      { name: 'Navan' },
      { name: 'Ennis' },
      { name: 'Tralee' },
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
      { name: 'Venice' },
      { name: 'Genoa' },
      { name: 'Palermo' },
      { name: 'Bari' },
      { name: 'Verona' },
      { name: 'Catania' },
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
      { name: 'Strasbourg' },
      { name: 'Montpellier' },
      { name: 'Bordeaux' },
      { name: 'Lille' },
      { name: 'Rennes' },
      { name: 'Reims' },
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
