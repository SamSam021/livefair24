// data/seo-cities.js
//
// Real "City" entity records, per the SEO architecture spec section 3 —
// a canonical, database-style record independent of any visitor's IP,
// used exclusively by routes/cityPage.js to render deterministic
// /events/{slug}/ landing pages. This is deliberately separate from
// data/major-cities.js (the editorial "browse by city" carousel list,
// which is about UI presentation) — this file's job is SEO identity:
// which cities get a permanent indexable URL, and what that URL says.
//
// Pilot scope only (spec section 35: prove the architecture on 3 cities
// before scaling) — Berlin, Essen, Dresden. Adding a city here is the
// only step needed to give it a real /events/{slug}/ page; routes/
// cityPage.js and server.js's routing both key off this list, nothing
// hardcoded per-city beyond what's declared here.

const SEO_CITIES = [
  {
    slug: 'berlin',
    name: 'Berlin',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Berlin. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Berlin, from arena tours at venues like Waldbühne and Uber Arena to intimate club shows across the city. LiveFair24 lists upcoming Berlin events with dates, venues, and ticket links.',
  },
  {
    slug: 'essen',
    name: 'Essen',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Essen. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Essen, home to the Grugahalle and other regional venues drawing touring acts across the Ruhr area. LiveFair24 lists upcoming Essen events with dates, venues, and ticket links.',
  },
  {
    slug: 'dresden',
    name: 'Dresden',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Dresden. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Dresden, centered on venues like the Kulturpalast and Filmnächte am Elbufer. LiveFair24 lists upcoming Dresden events with dates, venues, and ticket links.',
  },
];

function getSeoCityBySlug(slug) {
  return SEO_CITIES.find((c) => c.slug === slug) || null;
}

module.exports = { SEO_CITIES, getSeoCityBySlug };
