// routes/cities.js
//
// Powers /api/cities — detects the visitor's country from their IP (same
// lookup routes/trending.js already uses for the homepage) and returns
// the curated 6 major cities for that country, so the "Browse concerts
// by cities" page shows cities relevant to whoever's looking at it
// instead of a fixed list.

const ipapi = require('../providers/geo/ipapi');
const { getMajorCitiesForCountry } = require('../data/major-cities');

async function getCitiesForVisitor(clientIp, overrideCountry) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  // Same diagnostic-only escape hatch as /api/trending's ?country= param —
  // lets a specific country's city list be checked directly without
  // needing to actually be there.
  const requestedCountry = overrideCountry || detectedCountry;
  const { countryCode, countryName, flag, cities } = getMajorCitiesForCountry(requestedCountry);

  return {
    countryCode,
    countryName,
    flag,
    detectedCountry,
    cities,
  };
}

module.exports = { getCitiesForVisitor };
