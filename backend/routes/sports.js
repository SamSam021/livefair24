// routes/sports.js
//
// HTTP-facing handlers for sports-specific data (teams, leagues, matches
// with full home/away/venue detail). For the generic "what's coming up
// regardless of type" feed, see routes/events.js instead — that's what
// Section 3's "one underlying ecosystem" principle is actually about.

const sportsQueries = require('../db/queries/sports');

async function listSports() {
  const sports = await sportsQueries.getSports();
  return { count: sports.length, results: sports };
}

async function listLeagues() {
  const leagues = await sportsQueries.getLeagues();
  return { count: leagues.length, results: leagues };
}

async function listTeams() {
  const teams = await sportsQueries.getTeams();
  return { count: teams.length, results: teams };
}

async function getTeam(slug) {
  const team = await sportsQueries.getTeamBySlug(slug);
  if (!team) {
    throw Object.assign(new Error('Team not found'), { statusCode: 404 });
  }
  const upcomingMatches = await sportsQueries.getUpcomingMatchesForTeam(team.id);
  return { team, upcomingMatches };
}

async function getMatch(slug) {
  const match = await sportsQueries.getMatchBySlug(slug);
  if (!match) {
    throw Object.assign(new Error('Match not found'), { statusCode: 404 });
  }
  return { match };
}

async function getLeagueFixtures(slug) {
  const matches = await sportsQueries.getUpcomingMatchesForLeague(slug);
  return { count: matches.length, results: matches };
}

module.exports = { listSports, listLeagues, listTeams, getTeam, getMatch, getLeagueFixtures };
