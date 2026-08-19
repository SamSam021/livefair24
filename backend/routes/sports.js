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

// The three functions below power a sport's own category page
// (/football/, eventually /baseball/, /basketball/ once those have real
// data) — every one of them is scoped by sportSlug all the way down
// into the SQL itself (see db/queries/sports.js), not filtered
// afterward, so there's no path by which one sport's page could end up
// showing another sport's teams or matches.

async function getSportMatches(sportSlug) {
  const sport = await sportsQueries.getSportBySlug(sportSlug);
  if (!sport) {
    throw Object.assign(new Error('Sport not found'), { statusCode: 404 });
  }
  const matches = await sportsQueries.getUpcomingMatchesForSport(sportSlug);
  return { sport, count: matches.length, results: matches };
}

// Shaped to match what the frontend's card renderer already expects
// from /api/suggested (id/name/slug/count/imageUrl) so the same
// suggested-card CSS can render a team card without a parallel markup
// path — imageUrl is always null here since the fictional seed data
// has no team logos (see db/seed-data/sports.js), which is fine: the
// existing icon-fallback rendering already handles that gracefully for
// every other card type on the site.
async function getSportSuggested(sportSlug) {
  const sport = await sportsQueries.getSportBySlug(sportSlug);
  if (!sport) {
    throw Object.assign(new Error('Sport not found'), { statusCode: 404 });
  }
  const teams = await sportsQueries.getTeamsForSport(sportSlug);
  const trending = teams
    .filter((t) => Number(t.upcoming_count) > 0)
    .slice(0, 6)
    .map((t) => ({ id: t.id, name: t.name, slug: t.slug, count: Number(t.upcoming_count), imageUrl: t.logo_url || null }));
  return { sport, trending };
}

async function searchSportMatches(sportSlug, q) {
  const sport = await sportsQueries.getSportBySlug(sportSlug);
  if (!sport) {
    throw Object.assign(new Error('Sport not found'), { statusCode: 404 });
  }
  const keyword = (q || '').trim();
  if (!keyword) {
    const matches = await sportsQueries.getUpcomingMatchesForSport(sportSlug);
    return { sport, count: matches.length, results: matches };
  }
  const matches = await sportsQueries.searchMatchesForSport(sportSlug, keyword);
  return { sport, count: matches.length, results: matches };
}

module.exports = { listSports, listLeagues, listTeams, getTeam, getMatch, getLeagueFixtures, getSportMatches, getSportSuggested, searchSportMatches };
