// db/seed-data/sports.js
//
// Fictional football data for demo mode — same principle as the fictional
// concert artists (Nova Wren, Rosa Calder): real-feeling but invented, so
// there's no trademark/logo issue with real clubs, and the site works
// before you have a real sports data provider API key.
//
// A real sports data provider (not built yet — you haven't named one) would
// replace this file's role: same shape of data, pulled from a live API and
// synced into Postgres the same way this seed script does it.

const SPORT = { slug: 'football', name: 'Football', icon: 'football' };

const LEAGUE = { slug: 'rheinliga', name: 'Rheinliga', countryCode: 'DE' };

const SEASON = { name: '2026/27' };

const VENUES = [
  { slug: 'nordtor-stadion', name: 'Nordtor Stadion', city: 'Hamburg', countryCode: 'DE', lat: 53.5511, lng: 9.9937, capacity: 51000 },
  { slug: 'rheinpark-arena', name: 'Rheinpark Arena', city: 'Cologne', countryCode: 'DE', lat: 50.9375, lng: 6.9603, capacity: 46000 },
  { slug: 'kristallpark', name: 'Kristallpark', city: 'Munich', countryCode: 'DE', lat: 48.1351, lng: 11.5820, capacity: 58000 },
  { slug: 'ostpark-stadion', name: 'Ostpark Stadion', city: 'Berlin', countryCode: 'DE', lat: 52.5200, lng: 13.4050, capacity: 44000 },
  { slug: 'mainturm-arena', name: 'Mainturm Arena', city: 'Frankfurt', countryCode: 'DE', lat: 50.1109, lng: 8.6821, capacity: 49000 },
  { slug: 'schwarzwald-stadion', name: 'Schwarzwald Stadion', city: 'Freiburg', countryCode: 'DE', lat: 47.9990, lng: 7.8421, capacity: 34000 },
];

const TEAMS = [
  { slug: 'nordwall-fc', name: 'Nordwall FC', venueSlug: 'nordtor-stadion', countryCode: 'DE' },
  { slug: 'rheingold-united', name: 'Rheingold United', venueSlug: 'rheinpark-arena', countryCode: 'DE' },
  { slug: 'fc-bergkristall', name: 'FC Bergkristall', venueSlug: 'kristallpark', countryCode: 'DE' },
  { slug: 'ostpark-berlin', name: 'Ostpark Berlin', venueSlug: 'ostpark-stadion', countryCode: 'DE' },
  { slug: 'mainturm-sv', name: 'Mainturm SV', venueSlug: 'mainturm-arena', countryCode: 'DE' },
  { slug: 'schwarzwald-sv', name: 'Schwarzwald SV', venueSlug: 'schwarzwald-stadion', countryCode: 'DE' },
];

// Deterministic fixture list, matching the concert EVENTS array's pattern.
// Each fixture is played at the home team's venue.
const FIXTURES = [
  { homeSlug: 'fc-bergkristall', awaySlug: 'rheingold-united', date: '2026-09-12T15:30:00+02:00' },
  { homeSlug: 'ostpark-berlin', awaySlug: 'nordwall-fc', date: '2026-09-13T17:30:00+02:00' },
  { homeSlug: 'mainturm-sv', awaySlug: 'schwarzwald-sv', date: '2026-09-19T15:30:00+02:00' },
  { homeSlug: 'nordwall-fc', awaySlug: 'fc-bergkristall', date: '2026-09-26T17:30:00+02:00' },
  { homeSlug: 'rheingold-united', awaySlug: 'ostpark-berlin', date: '2026-10-03T15:30:00+02:00' },
  { homeSlug: 'schwarzwald-sv', awaySlug: 'mainturm-sv', date: '2026-10-04T17:30:00+02:00' },
];

function fixtureSlug(f) {
  return `${f.homeSlug}-vs-${f.awaySlug}-${f.date.slice(0, 10)}`;
}

function fixtureName(f, teamNameBySlug) {
  return `${teamNameBySlug[f.homeSlug]} vs ${teamNameBySlug[f.awaySlug]}`;
}

module.exports = { SPORT, LEAGUE, SEASON, VENUES, TEAMS, FIXTURES, fixtureSlug, fixtureName };
