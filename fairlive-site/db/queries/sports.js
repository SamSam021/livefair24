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

module.exports = {
  getSports,
  getLeagues,
  getTeams,
  getTeamBySlug,
  getUpcomingMatchesForTeam,
  getMatchBySlug,
  getUpcomingMatchesForLeague,
};
