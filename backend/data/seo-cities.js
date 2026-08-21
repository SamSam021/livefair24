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
// Rolled out from the original 3-city pilot (Berlin, Essen, Dresden —
// spec section 35's own staged-rollout instruction) to all 12 German
// cities already established elsewhere on the site (same list as
// data/major-cities.js's DE entry) — done only after the pilot was
// independently verified live (direct fetch confirmed real SSR content,
// real events, correct meta/canonical/H1) and the performance issues it
// surfaced (background pre-warming, per-page pagination caching) were
// fixed. Adding a city here is the only step needed to give it a real
// /events/{slug}/ page; routes/cityPage.js and server.js's routing both
// key off this list generically — no code changed to scale this.

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
    slug: 'hamburg',
    name: 'Hamburg',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Hamburg. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Hamburg, from arena tours at Barclays Arena to shows at the Elbphilharmonie and clubs around St. Pauli. LiveFair24 lists upcoming Hamburg events with dates, venues, and ticket links.',
  },
  {
    slug: 'munich',
    name: 'Munich',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Munich. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Munich, from major tours at Olympiahalle to smaller venues around the city. LiveFair24 lists upcoming Munich events with dates, venues, and ticket links.',
  },
  {
    slug: 'cologne',
    name: 'Cologne',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Cologne. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Cologne, including arena tours at Lanxess Arena and shows at venues across the city. LiveFair24 lists upcoming Cologne events with dates, venues, and ticket links.',
  },
  {
    slug: 'frankfurt',
    name: 'Frankfurt',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Frankfurt. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Frankfurt, including tours at Festhalle Frankfurt and venues across the city. LiveFair24 lists upcoming Frankfurt events with dates, venues, and ticket links.',
  },
  {
    slug: 'dusseldorf',
    name: 'Düsseldorf',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Düsseldorf. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Düsseldorf, including arena tours and club shows across the city. LiveFair24 lists upcoming Düsseldorf events with dates, venues, and ticket links.',
  },
  {
    slug: 'stuttgart',
    name: 'Stuttgart',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Stuttgart. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Stuttgart, from arena tours at the Schleyer-Halle to shows around the city. LiveFair24 lists upcoming Stuttgart events with dates, venues, and ticket links.',
  },
  {
    slug: 'leipzig',
    name: 'Leipzig',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Leipzig. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Leipzig, including arena tours and club shows across the city. LiveFair24 lists upcoming Leipzig events with dates, venues, and ticket links.',
  },
  {
    slug: 'dortmund',
    name: 'Dortmund',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Dortmund. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Dortmund, including tours at the Westfalenhallen and venues across the city. LiveFair24 lists upcoming Dortmund events with dates, venues, and ticket links.',
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
    slug: 'bremen',
    name: 'Bremen',
    country: 'Germany',
    countryCode: 'DE',
    seoDescription: 'Upcoming concerts and live shows in Bremen. Browse events, see venues and dates, and find tickets on LiveFair24.',
    seoIntro: 'Discover upcoming concerts and live shows in Bremen, including tours at the ÖVB-Arena and venues across the city. LiveFair24 lists upcoming Bremen events with dates, venues, and ticket links.',
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
