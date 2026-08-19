// db/seed-sports.js
//
// Loads the fictional demo sports data into Postgres AND creates a
// matching live_events row for every match — this second part is the
// actual proof of Step 8's requirement ("add sports without disrupting
// concert functionality," using the SAME generic architecture Step 7
// built). A sports feature that only wrote to matches/teams/leagues
// without also appearing in live_events wouldn't actually be integrated;
// it'd just be a second, parallel system living next to LiveEvent instead
// of inside it.
//
// Run with: npm run db:seed-sports
// Idempotent — ON CONFLICT (slug) DO UPDATE throughout, safe to re-run.

const { query, isConfigured } = require('./pg-client');
const { SPORTS_DATA, fixtureSlug, fixtureName } = require('./seed-data/sports');

async function getCountryId(code) {
  const result = await query('SELECT id FROM countries WHERE code = $1', [code]);
  if (result.rows.length === 0) {
    throw new Error(`Country code "${code}" not found — run db:seed-events first (it seeds countries).`);
  }
  return result.rows[0].id;
}

async function upsertSport(sport) {
  const result = await query(
    `INSERT INTO sports (name, slug, icon) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon
     RETURNING id`,
    [sport.name, sport.slug, sport.icon]
  );
  return result.rows[0].id;
}

async function upsertLeague(league, sportId, countryId) {
  const result = await query(
    `INSERT INTO leagues (sport_id, name, slug, country_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [sportId, league.name, league.slug, countryId]
  );
  return result.rows[0].id;
}

async function upsertSeason(season, leagueId) {
  const existing = await query('SELECT id FROM seasons WHERE league_id = $1 AND name = $2', [leagueId, season.name]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const inserted = await query(
    'INSERT INTO seasons (league_id, name) VALUES ($1, $2) RETURNING id',
    [leagueId, season.name]
  );
  return inserted.rows[0].id;
}

async function upsertVenue(v, countryId) {
  const result = await query(
    `INSERT INTO venues (name, slug, city, country_id, latitude, longitude, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, city = EXCLUDED.city, latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude, capacity = EXCLUDED.capacity
     RETURNING id`,
    [v.name, v.slug, v.city, countryId, v.lat, v.lng, v.capacity]
  );
  return result.rows[0].id;
}

async function upsertTeam(t, sportId, leagueId, countryId, venueId) {
  const result = await query(
    `INSERT INTO teams (name, slug, sport_id, league_id, country_id, venue_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, venue_id = EXCLUDED.venue_id
     RETURNING id`,
    [t.name, t.slug, sportId, leagueId, countryId, venueId]
  );
  return result.rows[0].id;
}

async function upsertMatch(f, seasonId, teamIdBySlug, venueIdByTeamSlug) {
  const slug = fixtureSlug(f);
  const result = await query(
    `INSERT INTO matches (competition_id, home_team_id, away_team_id, venue_id, start_datetime, slug, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
     ON CONFLICT (slug) DO UPDATE SET start_datetime = EXCLUDED.start_datetime
     RETURNING id`,
    [seasonId, teamIdBySlug[f.homeSlug], teamIdBySlug[f.awaySlug], venueIdByTeamSlug[f.homeSlug], f.date, slug]
  );
  return result.rows[0].id;
}

// The proof step: create/update the live_events row for this match, using
// the SAME table Step 7 put concerts into.
async function upsertLiveEventForMatch(f, matchId, venueId, teamNameBySlug) {
  const slug = fixtureSlug(f);
  const name = fixtureName(f, teamNameBySlug);
  await query(
    `INSERT INTO live_events (event_type, slug, name, venue_id, start_datetime, match_id)
     VALUES ('SPORT', $1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, venue_id = EXCLUDED.venue_id, start_datetime = EXCLUDED.start_datetime, match_id = EXCLUDED.match_id`,
    [slug, name, venueId, f.date, matchId]
  );
}

async function seedOneSport({ SPORT, LEAGUE, SEASON, VENUES, TEAMS, FIXTURES }) {
  const countryId = await getCountryId(LEAGUE.countryCode);
  const sportId = await upsertSport(SPORT);
  const leagueId = await upsertLeague(LEAGUE, sportId, countryId);
  const seasonId = await upsertSeason(SEASON, leagueId);

  const venueIdBySlug = {};
  for (const v of VENUES) venueIdBySlug[v.slug] = await upsertVenue(v, await getCountryId(v.countryCode));

  const teamIdBySlug = {};
  const teamNameBySlug = {};
  const venueIdByTeamSlug = {};
  for (const t of TEAMS) {
    const venueId = venueIdBySlug[t.venueSlug];
    teamIdBySlug[t.slug] = await upsertTeam(t, sportId, leagueId, await getCountryId(t.countryCode), venueId);
    teamNameBySlug[t.slug] = t.name;
    venueIdByTeamSlug[t.slug] = venueId;
  }

  for (const f of FIXTURES) {
    const matchId = await upsertMatch(f, seasonId, teamIdBySlug, venueIdByTeamSlug);
    await upsertLiveEventForMatch(f, matchId, venueIdByTeamSlug[f.homeSlug], teamNameBySlug);
  }

  console.log(`  ✓ ${SPORT.name}: 1 league, 1 season, ${VENUES.length} venues, ${TEAMS.length} teams, ${FIXTURES.length} matches.`);
}

async function seed() {
  if (!isConfigured()) {
    console.error('PostgreSQL is not configured. Set PG_CONNECTION_STRING or PG_HOST/etc, then re-run.');
    process.exit(1);
  }

  console.log('Seeding demo sports data...');

  for (const sportData of SPORTS_DATA) {
    await seedOneSport(sportData);
  }

  const totalVenues = SPORTS_DATA.reduce((n, s) => n + s.VENUES.length, 0);
  const totalTeams = SPORTS_DATA.reduce((n, s) => n + s.TEAMS.length, 0);
  const totalFixtures = SPORTS_DATA.reduce((n, s) => n + s.FIXTURES.length, 0);
  console.log(`✓ Seeded ${SPORTS_DATA.length} sports total: ${totalVenues} venues, ${totalTeams} teams, ${totalFixtures} matches (+ ${totalFixtures} live_events rows).`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('✗ Seeding failed:', err.message);
  process.exit(1);
});
