// db/queries/sports.js
//
// Read-only queries for sports data. Kept separate from liveEvents.js —
// pages showing a match's sports-specific details (home/away teams,
// league, season) query this file; pages showing the generic upcoming
// events feed (concerts + matches together) query liveEvents.js. Both
// read from the same underlying data, just shaped differently.

const { query } = require('../pg-client');

async function getSports() {
  const result = await query('SELECT id, name, slug, icon FROM sports ORDER BY name');
  return result.rows;
}

async function getLeagues() {
  const result = await query(
    `SELECT l.id, l.name, l.slug, l.logo_url, s.name AS sport_name, s.slug AS sport_slug, c.name AS country_name
     FROM leagues l
     JOIN sports s ON s.id = l.sport_id
     LEFT JOIN countries c ON c.id = l.country_id
     ORDER BY l.name`
  );
  return result.rows;
}

async function getTeams() {
  const result = await query(
    `SELECT t.id, t.name, t.slug, t.logo_url, v.name AS venue_name, v.slug AS venue_slug, v.city,
            l.name AS league_name, l.slug AS league_slug
     FROM teams t
     LEFT JOIN venues v ON v.id = t.venue_id
     LEFT JOIN leagues l ON l.id = t.league_id
     ORDER BY t.name`
  );
  return result.rows;
}

async function getTeamBySlug(slug) {
  const result = await query(
    `SELECT t.id, t.name, t.slug, t.logo_url,
            v.name AS venue_name, v.slug AS venue_slug, v.city, v.latitude, v.longitude, v.capacity,
            l.name AS league_name, l.slug AS league_slug
     FROM teams t
     LEFT JOIN venues v ON v.id = t.venue_id
     LEFT JOIN leagues l ON l.id = t.league_id
     WHERE t.slug = $1`,
    [slug]
  );
  return result.rows[0] || null;
}

// Upcoming matches for a team — either home or away — soonest first.
async function getUpcomingMatchesForTeam(teamId, limit = 10) {
  const result = await query(
    `SELECT m.id, m.slug, m.start_datetime, m.status,
            ht.name AS home_team_name, ht.slug AS home_team_slug,
            awt.name AS away_team_name, awt.slug AS away_team_slug,
            v.name AS venue_name, v.slug AS venue_slug, v.city
     FROM matches m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams awt ON awt.id = m.away_team_id
     LEFT JOIN venues v ON v.id = m.venue_id
     WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
       AND m.start_datetime >= now()
     ORDER BY m.start_datetime ASC
     LIMIT $2`,
    [teamId, limit]
  );
  return result.rows;
}

async function getMatchBySlug(slug) {
  const result = await query(
    `SELECT m.id, m.slug, m.start_datetime, m.end_datetime, m.status,
            ht.id AS home_team_id, ht.name AS home_team_name, ht.slug AS home_team_slug,
            awt.id AS away_team_id, awt.name AS away_team_name, awt.slug AS away_team_slug,
            v.name AS venue_name, v.slug AS venue_slug, v.city, v.latitude, v.longitude, v.capacity,
            se.name AS season_name, l.name AS league_name, l.slug AS league_slug
     FROM matches m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams awt ON awt.id = m.away_team_id
     LEFT JOIN venues v ON v.id = m.venue_id
     LEFT JOIN seasons se ON se.id = m.competition_id
     LEFT JOIN leagues l ON l.id = se.league_id
     WHERE m.slug = $1`,
    [slug]
  );
  return result.rows[0] || null;
}

async function getUpcomingMatchesForLeague(leagueSlug, limit = 20) {
  const result = await query(
    `SELECT m.id, m.slug, m.start_datetime, m.status,
            ht.name AS home_team_name, ht.slug AS home_team_slug,
            awt.name AS away_team_name, awt.slug AS away_team_slug,
            v.name AS venue_name, v.city
     FROM matches m
     JOIN seasons se ON se.id = m.competition_id
     JOIN leagues l ON l.id = se.league_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams awt ON awt.id = m.away_team_id
     LEFT JOIN venues v ON v.id = m.venue_id
     WHERE l.slug = $1 AND m.start_datetime >= now()
     ORDER BY m.start_datetime ASC
     LIMIT $2`,
    [leagueSlug, limit]
  );
  return result.rows;
}

async function getSportBySlug(slug) {
  const result = await query('SELECT id, name, slug, icon FROM sports WHERE slug = $1', [slug]);
  return result.rows[0] || null;
}

// Teams for a given sport, with each team's own upcoming match count —
// the DB-backed equivalent of routes/suggested.js's real event counts,
// so a sport's category page can show genuine "X upcoming" numbers on
// its own Suggested-style cards instead of a fabricated figure.
async function getTeamsForSport(sportSlug) {
  const result = await query(
    `SELECT t.id, t.name, t.slug, t.logo_url, v.city,
            l.name AS league_name, l.slug AS league_slug,
            COUNT(m.id) FILTER (WHERE m.start_datetime >= now()) AS upcoming_count
     FROM teams t
     JOIN sports s ON s.id = t.sport_id
     LEFT JOIN venues v ON v.id = t.venue_id
     LEFT JOIN leagues l ON l.id = t.league_id
     LEFT JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id)
     WHERE s.slug = $1
     GROUP BY t.id, v.city, l.name, l.slug
     ORDER BY upcoming_count DESC, t.name`,
    [sportSlug]
  );
  return result.rows;
}

// Every upcoming match for a sport, across all of that sport's leagues —
// generalizes getUpcomingMatchesForLeague (which needs one specific
// league slug) to "the whole sport", the same way a category page needs
// "all football", not "all Rheinliga" specifically. Behaves identically
// to the league-scoped version today since football only has one league
// seeded, but doesn't need touching again if a second league is added.
async function getUpcomingMatchesForSport(sportSlug, limit = 20) {
  const result = await query(
    `SELECT m.id, m.slug, m.start_datetime, m.status,
            ht.name AS home_team_name, ht.slug AS home_team_slug,
            awt.name AS away_team_name, awt.slug AS away_team_slug,
            v.name AS venue_name, v.city,
            l.name AS league_name, l.slug AS league_slug
     FROM matches m
     JOIN seasons se ON se.id = m.competition_id
     JOIN leagues l ON l.id = se.league_id
     JOIN sports s ON s.id = l.sport_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams awt ON awt.id = m.away_team_id
     LEFT JOIN venues v ON v.id = m.venue_id
     WHERE s.slug = $1 AND m.start_datetime >= now()
     ORDER BY m.start_datetime ASC
     LIMIT $2`,
    [sportSlug, limit]
  );
  return result.rows;
}

// Keyword search scoped to one sport — matches against either team's
// name, same idea as the ticket-provider keyword search but against our
// own DB instead of Ticketmaster, since this sport's real data lives
// here, not with a ticket provider. Never touches other sports' teams
// even if a query happens to match one, since sportSlug is part of the
// WHERE clause itself, not a post-filter.
async function searchMatchesForSport(sportSlug, keyword, limit = 20) {
  const result = await query(
    `SELECT m.id, m.slug, m.start_datetime, m.status,
            ht.name AS home_team_name, ht.slug AS home_team_slug,
            awt.name AS away_team_name, awt.slug AS away_team_slug,
            v.name AS venue_name, v.city,
            l.name AS league_name, l.slug AS league_slug
     FROM matches m
     JOIN seasons se ON se.id = m.competition_id
     JOIN leagues l ON l.id = se.league_id
     JOIN sports s ON s.id = l.sport_id
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams awt ON awt.id = m.away_team_id
     LEFT JOIN venues v ON v.id = m.venue_id
     WHERE s.slug = $1 AND m.start_datetime >= now()
       AND (ht.name ILIKE $2 OR awt.name ILIKE $2 OR v.name ILIKE $2 OR v.city ILIKE $2)
     ORDER BY m.start_datetime ASC
     LIMIT $3`,
    [sportSlug, `%${keyword}%`, limit]
  );
  return result.rows;
}

module.exports = {
  getSports,
  getSportBySlug,
  getLeagues,
  getTeams,
  getTeamsForSport,
  getTeamBySlug,
  getUpcomingMatchesForTeam,
  getUpcomingMatchesForSport,
  searchMatchesForSport,
  getMatchBySlug,
  getUpcomingMatchesForLeague,
};
