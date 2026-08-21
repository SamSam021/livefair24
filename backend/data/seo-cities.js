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
    seoTitle: 'Events in Berlin 2026 — Concerts & Tickets | LiveFair24',
    seoDescription: 'Upcoming concerts and live events in Berlin. Real, live ticket prices and venues, updated every 2 minutes.',
    seoIntro: 'Berlin hosts everything from arena tours to intimate club shows across venues like Waldbühne, Mercedes-Benz Arena, and countless smaller stages throughout the city. Find upcoming concerts below with real, live ticket prices.',
  },
  {
    slug: 'essen',
    name: 'Essen',
    country: 'Germany',
    countryCode: 'DE',
    seoTitle: 'Events in Essen 2026 — Concerts & Tickets | LiveFair24',
    seoDescription: 'Upcoming concerts and live events in Essen. Real, live ticket prices and venues, updated every 2 minutes.',
    seoIntro: 'Essen is home to the Grugahalle and other regional venues drawing touring acts across the Ruhr area. Find upcoming concerts below with real, live ticket prices.',
  },
  {
    slug: 'dresden',
    name: 'Dresden',
    country: 'Germany',
    countryCode: 'DE',
    seoTitle: 'Events in Dresden 2026 — Concerts & Tickets | LiveFair24',
    seoDescription: 'Upcoming concerts and live events in Dresden. Real, live ticket prices and venues, updated every 2 minutes.',
    seoIntro: 'Dresden\u2019s event scene centers on venues like the Kulturpalast and Filmnächte am Elbufer, hosting everything from orchestral tours to touring rock acts. Find upcoming concerts below with real, live ticket prices.',
  },
];

function getSeoCityBySlug(slug) {
  return SEO_CITIES.find((c) => c.slug === slug) || null;
}

module.exports = { SEO_CITIES, getSeoCityBySlug };
