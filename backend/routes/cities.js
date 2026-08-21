// routes/cities.js
//
// Powers /api/cities — detects the visitor's country from their IP (same
// lookup routes/trending.js already uses for the homepage) and returns
// the curated 12 major cities for that country, so the "Browse concerts
// by cities" page shows cities relevant to whoever's looking at it
// instead of a fixed list.

const ipapi = require('../providers/geo/ipapi');
const cityImage = require('../providers/geo/cityImage');
const { getMajorCitiesForCountry } = require('../data/major-cities');

async function getCitiesForVisitor(clientIp, overrideCountry) {
  const detectedCountry = await ipapi.getCountryCodeForIp(clientIp);
  // Same diagnostic-only escape hatch as /api/trending's ?country= param —
  // lets a specific country's city list be checked directly without
  // needing to actually be there.
  const requestedCountry = overrideCountry || detectedCountry;
  const { countryCode, countryName, flag, cities } = getMajorCitiesForCountry(requestedCountry);

  // Real photo of each city — same Wikipedia page-images lookup already
  // used for venue cards on the Suggested carousel (providers/geo/
  // cityImage.js), reused here because this is the literal, unambiguous
  // case it was built for: showing what a named city actually looks
  // like, not a stand-in for something that has no photo of its own.
  // Run in parallel since each is an independent lookup.
  const citiesWithImages = await Promise.all(
    cities.map(async (city) => ({ ...city, imageUrl: await cityImage.getCityImageUrl(city.name, null, city.wikiTitle) }))
  );

  return {
    countryCode,
    countryName,
    flag,
    detectedCountry,
    cities: citiesWithImages,
  };
}

module.exports = { getCitiesForVisitor };
