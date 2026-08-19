// db/seed-data/sports.js
//
// Fictional sports data for demo mode — same principle as the fictional
// concert artists (Nova Wren, Rosa Calder): real-feeling but invented, so
// there's no trademark/logo issue with real clubs, and the site works
// before you have a real sports data provider API key.
//
// A real sports data provider (not built yet — you haven't named one) would
// replace this file's role: same shape of data, pulled from a live API and
// synced into Postgres the same way this seed script does it.
//
// One entry per sport — db/seed-sports.js loops over SPORTS_DATA rather
// than hardcoding a single sport, so adding a sport here is the only
// step needed; every backend query, route, and API endpoint
// (db/queries/sports.js, routes/sports.js, /api/sports/:sportSlug/...)
// is already generic by sport slug and needs no changes.

const SPORTS_DATA = [
  {
    SPORT: { slug: 'football', name: 'Football', icon: 'football' },
    LEAGUE: { slug: 'rheinliga', name: 'Rheinliga', countryCode: 'DE' },
    SEASON: { name: '2026/27' },
    VENUES: [
      { slug: 'nordtor-stadion', name: 'Nordtor Stadion', city: 'Hamburg', countryCode: 'DE', lat: 53.5511, lng: 9.9937, capacity: 51000 },
      { slug: 'rheinpark-arena', name: 'Rheinpark Arena', city: 'Cologne', countryCode: 'DE', lat: 50.9375, lng: 6.9603, capacity: 46000 },
      { slug: 'kristallpark', name: 'Kristallpark', city: 'Munich', countryCode: 'DE', lat: 48.1351, lng: 11.5820, capacity: 58000 },
      { slug: 'ostpark-stadion', name: 'Ostpark Stadion', city: 'Berlin', countryCode: 'DE', lat: 52.5200, lng: 13.4050, capacity: 44000 },
      { slug: 'mainturm-arena', name: 'Mainturm Arena', city: 'Frankfurt', countryCode: 'DE', lat: 50.1109, lng: 8.6821, capacity: 49000 },
      { slug: 'schwarzwald-stadion', name: 'Schwarzwald Stadion', city: 'Freiburg', countryCode: 'DE', lat: 47.9990, lng: 7.8421, capacity: 34000 },
    ],
    TEAMS: [
      { slug: 'nordwall-fc', name: 'Nordwall FC', venueSlug: 'nordtor-stadion', countryCode: 'DE' },
      { slug: 'rheingold-united', name: 'Rheingold United', venueSlug: 'rheinpark-arena', countryCode: 'DE' },
      { slug: 'fc-bergkristall', name: 'FC Bergkristall', venueSlug: 'kristallpark', countryCode: 'DE' },
      { slug: 'ostpark-berlin', name: 'Ostpark Berlin', venueSlug: 'ostpark-stadion', countryCode: 'DE' },
      { slug: 'mainturm-sv', name: 'Mainturm SV', venueSlug: 'mainturm-arena', countryCode: 'DE' },
      { slug: 'schwarzwald-sv', name: 'Schwarzwald SV', venueSlug: 'schwarzwald-stadion', countryCode: 'DE' },
    ],
    FIXTURES: [
      { homeSlug: 'fc-bergkristall', awaySlug: 'rheingold-united', date: '2026-09-12T15:30:00+02:00' },
      { homeSlug: 'ostpark-berlin', awaySlug: 'nordwall-fc', date: '2026-09-13T17:30:00+02:00' },
      { homeSlug: 'mainturm-sv', awaySlug: 'schwarzwald-sv', date: '2026-09-19T15:30:00+02:00' },
      { homeSlug: 'nordwall-fc', awaySlug: 'fc-bergkristall', date: '2026-09-26T17:30:00+02:00' },
      { homeSlug: 'rheingold-united', awaySlug: 'ostpark-berlin', date: '2026-10-03T15:30:00+02:00' },
      { homeSlug: 'schwarzwald-sv', awaySlug: 'mainturm-sv', date: '2026-10-04T17:30:00+02:00' },
    ],
  },
  {
    SPORT: { slug: 'basketball', name: 'Basketball', icon: 'basketball' },
    LEAGUE: { slug: 'liberty-league', name: 'Liberty League', countryCode: 'US' },
    SEASON: { name: '2026/27' },
    VENUES: [
      { slug: 'harbor-dome', name: 'Harbor Dome', city: 'New York', countryCode: 'US', lat: 40.7128, lng: -74.0060, capacity: 19500 },
      { slug: 'westgate-arena', name: 'Westgate Arena', city: 'Los Angeles', countryCode: 'US', lat: 34.0522, lng: -118.2437, capacity: 18800 },
      { slug: 'lakeside-pavilion', name: 'Lakeside Pavilion', city: 'Chicago', countryCode: 'US', lat: 41.8781, lng: -87.6298, capacity: 20500 },
      { slug: 'riverside-fieldhouse', name: 'Riverside Fieldhouse', city: 'Houston', countryCode: 'US', lat: 29.7604, lng: -95.3698, capacity: 18100 },
      { slug: 'bayfront-center', name: 'Bayfront Center', city: 'Miami', countryCode: 'US', lat: 25.7617, lng: -80.1918, capacity: 19600 },
      { slug: 'summit-arena', name: 'Summit Arena', city: 'San Francisco', countryCode: 'US', lat: 37.7749, lng: -122.4194, capacity: 18300 },
    ],
    TEAMS: [
      { slug: 'new-york-voyage', name: 'New York Voyage', venueSlug: 'harbor-dome', countryCode: 'US' },
      { slug: 'la-static', name: 'LA Static', venueSlug: 'westgate-arena', countryCode: 'US' },
      { slug: 'chicago-ironclad', name: 'Chicago Ironclad', venueSlug: 'lakeside-pavilion', countryCode: 'US' },
      { slug: 'houston-blaze', name: 'Houston Blaze', venueSlug: 'riverside-fieldhouse', countryCode: 'US' },
      { slug: 'miami-tide', name: 'Miami Tide', venueSlug: 'bayfront-center', countryCode: 'US' },
      { slug: 'san-francisco-vertex', name: 'San Francisco Vertex', venueSlug: 'summit-arena', countryCode: 'US' },
    ],
    FIXTURES: [
      { homeSlug: 'new-york-voyage', awaySlug: 'chicago-ironclad', date: '2026-10-14T19:30:00-04:00' },
      { homeSlug: 'la-static', awaySlug: 'miami-tide', date: '2026-10-15T19:00:00-07:00' },
      { homeSlug: 'houston-blaze', awaySlug: 'san-francisco-vertex', date: '2026-10-21T19:30:00-05:00' },
      { homeSlug: 'chicago-ironclad', awaySlug: 'la-static', date: '2026-10-28T19:00:00-05:00' },
      { homeSlug: 'miami-tide', awaySlug: 'new-york-voyage', date: '2026-11-04T19:30:00-05:00' },
      { homeSlug: 'san-francisco-vertex', awaySlug: 'houston-blaze', date: '2026-11-11T19:00:00-08:00' },
    ],
  },
  {
    SPORT: { slug: 'baseball', name: 'Baseball', icon: 'baseball' },
    LEAGUE: { slug: 'continental-league', name: 'Continental League', countryCode: 'US' },
    SEASON: { name: '2026' },
    VENUES: [
      { slug: 'anchor-field', name: 'Anchor Field', city: 'New York', countryCode: 'US', lat: 40.7128, lng: -74.0060, capacity: 41500 },
      { slug: 'horizon-park', name: 'Horizon Park', city: 'Los Angeles', countryCode: 'US', lat: 34.0522, lng: -118.2437, capacity: 44200 },
      { slug: 'ridge-field', name: 'Ridge Field', city: 'Chicago', countryCode: 'US', lat: 41.8781, lng: -87.6298, capacity: 38700 },
      { slug: 'sundog-stadium', name: 'Sundog Stadium', city: 'Houston', countryCode: 'US', lat: 29.7604, lng: -95.3698, capacity: 40900 },
      { slug: 'current-park', name: 'Current Park', city: 'Miami', countryCode: 'US', lat: 25.7617, lng: -80.1918, capacity: 36700 },
      { slug: 'fog-park', name: 'Fog Park', city: 'San Francisco', countryCode: 'US', lat: 37.7749, lng: -122.4194, capacity: 39300 },
    ],
    TEAMS: [
      { slug: 'new-york-anchors', name: 'New York Anchors', venueSlug: 'anchor-field', countryCode: 'US' },
      { slug: 'la-horizon', name: 'LA Horizon', venueSlug: 'horizon-park', countryCode: 'US' },
      { slug: 'chicago-ridge', name: 'Chicago Ridge', venueSlug: 'ridge-field', countryCode: 'US' },
      { slug: 'houston-sundogs', name: 'Houston Sundogs', venueSlug: 'sundog-stadium', countryCode: 'US' },
      { slug: 'miami-current', name: 'Miami Current', venueSlug: 'current-park', countryCode: 'US' },
      { slug: 'san-francisco-fog', name: 'San Francisco Fog', venueSlug: 'fog-park', countryCode: 'US' },
    ],
    FIXTURES: [
      { homeSlug: 'new-york-anchors', awaySlug: 'chicago-ridge', date: '2026-09-08T19:10:00-04:00' },
      { homeSlug: 'la-horizon', awaySlug: 'san-francisco-fog', date: '2026-09-09T19:10:00-07:00' },
      { homeSlug: 'houston-sundogs', awaySlug: 'miami-current', date: '2026-09-15T19:10:00-05:00' },
      { homeSlug: 'chicago-ridge', awaySlug: 'la-horizon', date: '2026-09-22T14:20:00-05:00' },
      { homeSlug: 'miami-current', awaySlug: 'new-york-anchors', date: '2026-09-29T18:40:00-04:00' },
      { homeSlug: 'san-francisco-fog', awaySlug: 'houston-sundogs', date: '2026-10-06T19:15:00-07:00' },
    ],
  },
  {
    SPORT: { slug: 'hockey', name: 'Hockey', icon: 'hockey' },
    LEAGUE: { slug: 'northland-league', name: 'Northland League', countryCode: 'US' },
    SEASON: { name: '2026/27' },
    VENUES: [
      { slug: 'frostline-arena', name: 'Frostline Arena', city: 'New York', countryCode: 'US', lat: 40.7128, lng: -74.0060, capacity: 18200 },
      { slug: 'timber-arena', name: 'Timber Arena', city: 'Chicago', countryCode: 'US', lat: 41.8781, lng: -87.6298, capacity: 19700 },
      { slug: 'cinder-rink', name: 'Cinder Rink', city: 'Boston', countryCode: 'US', lat: 42.3601, lng: -71.0589, capacity: 17600 },
      { slug: 'glacier-arena', name: 'Glacier Arena', city: 'Minneapolis', countryCode: 'US', lat: 44.9778, lng: -93.2650, capacity: 18100 },
      { slug: 'peak-arena', name: 'Peak Arena', city: 'Denver', countryCode: 'US', lat: 39.7392, lng: -104.9903, capacity: 18000 },
      { slug: 'forge-arena', name: 'Forge Arena', city: 'Detroit', countryCode: 'US', lat: 42.3314, lng: -83.0458, capacity: 19500 },
    ],
    TEAMS: [
      { slug: 'new-york-frost', name: 'New York Frost', venueSlug: 'frostline-arena', countryCode: 'US' },
      { slug: 'chicago-timber', name: 'Chicago Timber', venueSlug: 'timber-arena', countryCode: 'US' },
      { slug: 'boston-cinder', name: 'Boston Cinder', venueSlug: 'cinder-rink', countryCode: 'US' },
      { slug: 'minneapolis-glacier', name: 'Minneapolis Glacier', venueSlug: 'glacier-arena', countryCode: 'US' },
      { slug: 'denver-peak', name: 'Denver Peak', venueSlug: 'peak-arena', countryCode: 'US' },
      { slug: 'detroit-forge', name: 'Detroit Forge', venueSlug: 'forge-arena', countryCode: 'US' },
    ],
    FIXTURES: [
      { homeSlug: 'new-york-frost', awaySlug: 'boston-cinder', date: '2026-10-16T19:00:00-04:00' },
      { homeSlug: 'chicago-timber', awaySlug: 'detroit-forge', date: '2026-10-17T19:30:00-05:00' },
      { homeSlug: 'minneapolis-glacier', awaySlug: 'denver-peak', date: '2026-10-23T20:00:00-05:00' },
      { homeSlug: 'boston-cinder', awaySlug: 'chicago-timber', date: '2026-10-30T19:00:00-04:00' },
      { homeSlug: 'detroit-forge', awaySlug: 'minneapolis-glacier', date: '2026-11-06T19:30:00-05:00' },
      { homeSlug: 'denver-peak', awaySlug: 'new-york-frost', date: '2026-11-13T20:00:00-07:00' },
    ],
  },
  {
    SPORT: { slug: 'american-football', name: 'American Football', icon: 'american-football' },
    LEAGUE: { slug: 'gridiron-league', name: 'Gridiron League', countryCode: 'US' },
    SEASON: { name: '2026' },
    VENUES: [
      { slug: 'outlaw-stadium', name: 'Outlaw Stadium', city: 'Dallas', countryCode: 'US', lat: 32.7767, lng: -96.7970, capacity: 80000 },
      { slug: 'ember-stadium', name: 'Ember Stadium', city: 'Atlanta', countryCode: 'US', lat: 33.7490, lng: -84.3880, capacity: 71000 },
      { slug: 'tempest-field', name: 'Tempest Field', city: 'Seattle', countryCode: 'US', lat: 47.6062, lng: -122.3321, capacity: 69000 },
      { slug: 'vanguard-stadium', name: 'Vanguard Stadium', city: 'Philadelphia', countryCode: 'US', lat: 39.9526, lng: -75.1652, capacity: 67600 },
      { slug: 'solstice-stadium', name: 'Solstice Stadium', city: 'Phoenix', countryCode: 'US', lat: 33.4484, lng: -112.0740, capacity: 63400 },
      { slug: 'ridgeline-stadium', name: 'Ridgeline Stadium', city: 'Nashville', countryCode: 'US', lat: 36.1627, lng: -86.7816, capacity: 69100 },
    ],
    TEAMS: [
      { slug: 'dallas-outlaws', name: 'Dallas Outlaws', venueSlug: 'outlaw-stadium', countryCode: 'US' },
      { slug: 'atlanta-ember', name: 'Atlanta Ember', venueSlug: 'ember-stadium', countryCode: 'US' },
      { slug: 'seattle-tempest', name: 'Seattle Tempest', venueSlug: 'tempest-field', countryCode: 'US' },
      { slug: 'philadelphia-vanguard', name: 'Philadelphia Vanguard', venueSlug: 'vanguard-stadium', countryCode: 'US' },
      { slug: 'phoenix-solstice', name: 'Phoenix Solstice', venueSlug: 'solstice-stadium', countryCode: 'US' },
      { slug: 'nashville-ridgeline', name: 'Nashville Ridgeline', venueSlug: 'ridgeline-stadium', countryCode: 'US' },
    ],
    FIXTURES: [
      { homeSlug: 'dallas-outlaws', awaySlug: 'philadelphia-vanguard', date: '2026-09-13T13:00:00-05:00' },
      { homeSlug: 'atlanta-ember', awaySlug: 'nashville-ridgeline', date: '2026-09-20T13:00:00-04:00' },
      { homeSlug: 'seattle-tempest', awaySlug: 'phoenix-solstice', date: '2026-09-27T16:05:00-07:00' },
      { homeSlug: 'philadelphia-vanguard', awaySlug: 'atlanta-ember', date: '2026-10-04T13:00:00-04:00' },
      { homeSlug: 'phoenix-solstice', awaySlug: 'dallas-outlaws', date: '2026-10-11T16:25:00-07:00' },
      { homeSlug: 'nashville-ridgeline', awaySlug: 'seattle-tempest', date: '2026-10-18T13:00:00-05:00' },
    ],
  },
];

function fixtureSlug(f) {
  return `${f.homeSlug}-vs-${f.awaySlug}-${f.date.slice(0, 10)}`;
}

function fixtureName(f, teamNameBySlug) {
  return `${teamNameBySlug[f.homeSlug]} vs ${teamNameBySlug[f.awaySlug]}`;
}

module.exports = { SPORTS_DATA, fixtureSlug, fixtureName };
