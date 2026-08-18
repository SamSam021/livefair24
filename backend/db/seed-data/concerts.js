// db/seed-data/concerts.js
//
// The exact 6 concert events currently hardcoded in fairlive-site/index.html's
// EVENTS array — copied verbatim, not reinvented, specifically to prove
// Section 5's requirement: "The existing concert implementation must map
// cleanly into the generic model." If this data doesn't fit the LiveEvent
// schema without distortion, that's a real problem with the schema design,
// not just a seeding inconvenience.

const COUNTRIES = [
  { name: 'Germany', code: 'DE' },
  { name: 'Ireland', code: 'IE' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'Italy', code: 'IT' },
  { name: 'France', code: 'FR' },
];

const VENUES = [
  { slug: 'pier-2-bremen', name: 'Pier 2', city: 'Bremen', countryCode: 'DE', lat: 53.0793, lng: 8.8017 },
  { slug: 'waldbuhne-berlin', name: 'Waldbühne', city: 'Berlin', countryCode: 'DE', lat: 52.5200, lng: 13.4050 },
  { slug: '3olympia-theatre-dublin', name: '3Olympia Theatre', city: 'Dublin', countryCode: 'IE', lat: 53.3498, lng: -6.2603 },
  { slug: 'brixton-academy-london', name: 'Brixton Academy', city: 'London', countryCode: 'GB', lat: 51.5074, lng: -0.1278 },
  { slug: 'fabrique-milan', name: 'Fabrique', city: 'Milan', countryCode: 'IT', lat: 45.4642, lng: 9.1900 },
  { slug: 'zenith-paris', name: 'Zénith Paris', city: 'Paris', countryCode: 'FR', lat: 48.8566, lng: 2.3522 },
];

const ARTISTS = [
  { slug: 'rosa-calder', name: 'Rosa Calder' },
  { slug: 'nova-wren', name: 'Nova Wren' },
  { slug: 'silvertone', name: 'Silvertone' },
  { slug: 'delphine-static-choir', name: 'Delphine & The Static Choir' },
  { slug: 'nocturne', name: 'Nocturne' },
  { slug: 'kaito-reyes', name: 'Kaito Reyes' },
];

// Matches the live EVENTS array in index.html exactly — same artists,
// venues, and ISO dates/times (converted from the displayed date strings).
const EVENTS = [
  { slug: 'rosa-calder-bremen-2026-08-13', name: 'Rosa Calder — Bremen', artistSlug: 'rosa-calder', venueSlug: 'pier-2-bremen', startDatetime: '2026-08-13T20:00:00+02:00' },
  { slug: 'nova-wren-berlin-2026-08-16', name: 'Nova Wren — World Tour — Berlin', artistSlug: 'nova-wren', venueSlug: 'waldbuhne-berlin', startDatetime: '2026-08-16T19:30:00+02:00' },
  { slug: 'silvertone-dublin-2026-08-18', name: 'Silvertone — Dublin', artistSlug: 'silvertone', venueSlug: '3olympia-theatre-dublin', startDatetime: '2026-08-18T19:30:00+01:00' },
  { slug: 'delphine-london-2026-08-19', name: 'Delphine & The Static Choir — London', artistSlug: 'delphine-static-choir', venueSlug: 'brixton-academy-london', startDatetime: '2026-08-19T19:00:00+01:00' },
  { slug: 'nocturne-milan-2026-08-28', name: 'Nocturne — Milan', artistSlug: 'nocturne', venueSlug: 'fabrique-milan', startDatetime: '2026-08-28T22:00:00+02:00' },
  { slug: 'kaito-reyes-paris-2026-08-29', name: 'Kaito Reyes — Paris', artistSlug: 'kaito-reyes', venueSlug: 'zenith-paris', startDatetime: '2026-08-29T20:00:00+02:00' },
];

module.exports = { COUNTRIES, VENUES, ARTISTS, EVENTS };
