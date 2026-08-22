// server.js — the whole app in one process: serves the static frontend
// (from ../fairlive-site), the public /api/tickets + /api/hotels endpoints, and
// the password-protected /admin panel for managing provider API keys.
// Zero npm dependencies — runs anywhere Node.js runs, no `npm install` needed.
//
// Local run:   node server.js
// Deploy:      push this repo to Render/Railway/Fly.io/a VPS, set env vars
//              from .env.example in the host's dashboard, done.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { port } = require('./config');
const { handleTickets } = require('./routes/tickets');
const { handleHotels } = require('./routes/hotels');
const watcherRoutes = require('./routes/watchers');
const eventRoutes = require('./routes/events');
const sportsRoutes = require('./routes/sports');
const searchRoutes = require('./routes/search');
const trendingRoutes = require('./routes/trending');
const citiesRoutes = require('./routes/cities');
const eventPageRoutes = require('./routes/eventPage');
const cityPageRoutes = require('./routes/cityPage');
const { getSeoCityBySlug } = require('./data/seo-cities');
const eventsSitemapRoutes = require('./routes/eventsSitemap');
const artistVenueSitemapRoutes = require('./routes/artistVenueSitemap');
const artistPageRoutes = require('./routes/artistPage');
const venuePageRoutes = require('./routes/venuePage');
const suggestedRoutes = require('./routes/suggested');
const concertCategoriesRoutes = require('./routes/concertCategories');
const countryEventsRoutes = require('./routes/countryEvents');
const matchesRoutes = require('./routes/matches');
const registry = require('./providers/registry');
const adminAuth = require('./admin-auth');
const adminRoutes = require('./routes/admin');
const { runPriceCheck } = require('./price-check');
const configStore = require('./config-store');
const watchersStore = require('./watchers-store');
const persistence = require('./persistence');

const STATIC_ROOT = path.join(__dirname, '..', 'fairlive-site');
const ADMIN_ROOT = path.join(__dirname, 'admin');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function sendJSON(res, statusCode, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    // Every JSON response from this server is dynamic and often
    // IP/geolocation-personalized (e.g. /api/cities, /api/trending) —
    // confirmed real bug: with no cache header at all, a browser (or any
    // CDN in front of App Runner) was free to reuse an earlier response
    // indefinitely, so one visitor's homepage kept showing US cities
    // from a stale cached /api/cities response while a fresh request to
    // the same endpoint (via a different page, no cache entry yet)
    // correctly showed Germany. The routes that genuinely benefit from
    // caching (trending.js, concertCategories.js) already implement
    // their own explicit server-side cache with a real TTL — this only
    // stops uncontrolled, invisible caching one layer further out.
    'Cache-Control': 'no-store',
  }, extraHeaders || {}));
  res.end(body);
}

function serveFile(res, rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// Behind Railway's proxy, req.socket.remoteAddress is the proxy's own IP,
// not the visitor's — the real client IP is in X-Forwarded-For (which can
// be a comma-separated chain if there are multiple proxies; the first
// entry is the original client). Falls back to the socket address for
// local/direct testing where no proxy is involved.
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel = path.join(rel, 'index.html');
  serveFile(res, STATIC_ROOT, rel);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleAdminApi(req, res, pathname, query) {
  // Login is the one admin route that doesn't require an existing session
  if (pathname === '/admin/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (!adminAuth.checkPassword(body.password)) {
      return sendJSON(res, 401, { error: 'Incorrect password' });
    }
    const token = adminAuth.createSession();
    return sendJSON(res, 200, { ok: true }, {
      'Set-Cookie': `admin_session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Strict`,
    });
  }

  // Everything else under /admin/api/* requires a valid session cookie
  const cookies = adminAuth.parseCookies(req);
  if (!adminAuth.isValidSession(cookies.admin_session)) {
    return sendJSON(res, 401, { error: 'Not authenticated' });
  }

  if (pathname === '/admin/api/logout' && req.method === 'POST') {
    adminAuth.destroySession(cookies.admin_session);
    return sendJSON(res, 200, { ok: true }, {
      'Set-Cookie': 'admin_session=; HttpOnly; Path=/; Max-Age=0',
    });
  }

  try {
    if (pathname === '/admin/api/config' && req.method === 'GET') {
      return sendJSON(res, 200, adminRoutes.getConfig());
    }
    if (pathname === '/admin/api/credentials' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 200, adminRoutes.setCredential(body));
    }
    if (pathname.startsWith('/admin/api/credentials/') && req.method === 'DELETE') {
      const key = decodeURIComponent(pathname.split('/').pop());
      return sendJSON(res, 200, adminRoutes.deleteCredential(key));
    }
    if (pathname === '/admin/api/custom-providers' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJSON(res, 200, adminRoutes.upsertCustomProvider(body));
    }
    if (pathname.match(/^\/admin\/api\/custom-providers\/[^/]+$/) && req.method === 'DELETE') {
      const id = pathname.split('/').pop();
      return sendJSON(res, 200, adminRoutes.deleteCustomProvider(id));
    }
    if (pathname.match(/^\/admin\/api\/custom-providers\/[^/]+\/toggle$/) && req.method === 'PATCH') {
      const id = pathname.split('/')[4];
      const body = await readBody(req);
      return sendJSON(res, 200, adminRoutes.toggleCustomProvider(id, !!body.enabled));
    }
    if (pathname === '/admin/api/watchers' && req.method === 'GET') {
      return sendJSON(res, 200, adminRoutes.getWatcherStats());
    }
    if (pathname === '/admin/api/sent-emails' && req.method === 'GET') {
      return sendJSON(res, 200, adminRoutes.getDemoEmailLog());
    }
    if (pathname === '/admin/api/run-price-check' && req.method === 'POST') {
      return sendJSON(res, 200, await adminRoutes.triggerPriceCheck());
    }
    return sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    return sendJSON(res, err.statusCode || 500, { error: err.message || 'Internal server error' });
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  try {
    if (pathname === '/api/tickets') {
      const data = await handleTickets(query, registry.getMergedEnv());
      return sendJSON(res, 200, data);
    }
    if (pathname === '/api/hotels') {
      const data = await handleHotels(query, registry.getMergedEnv());
      return sendJSON(res, 200, data);
    }
    if (pathname === '/api/health') {
      // buildMarker lets you confirm exactly which deploy is actually
      // running with a single, instant request — separate from testing
      // any real feature — since "did the deploy actually go out" has
      // been genuinely hard to answer from the outside so far.
      return sendJSON(res, 200, { ok: true, buildMarker: 'suggested-images-v16' });
    }
    if (pathname === '/sitemap-events.xml' && req.method === 'GET') {
      try {
        const xml = await eventsSitemapRoutes.generateEventsSitemapXml(registry.getMergedEnv());
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(xml);
      } catch (err) {
        console.error('[events sitemap]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Could not generate events sitemap');
      }
    }
    if (pathname === '/sitemap-artists.xml' && req.method === 'GET') {
      try {
        const xml = await artistVenueSitemapRoutes.generateArtistsSitemapXml(registry.getMergedEnv());
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(xml);
      } catch (err) {
        console.error('[artists sitemap]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Could not generate artists sitemap');
      }
    }
    if (pathname === '/sitemap-venues.xml' && req.method === 'GET') {
      try {
        const xml = await artistVenueSitemapRoutes.generateVenuesSitemapXml(registry.getMergedEnv());
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
        return res.end(xml);
      } catch (err) {
        console.error('[venues sitemap]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Could not generate venues sitemap');
      }
    }
    if (pathname === '/api/search' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await searchRoutes.searchEvents(query, registry.getMergedEnv()));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/trending' && req.method === 'GET') {
      try {
        const clientIp = getClientIp(req);
        return sendJSON(res, 200, await trendingRoutes.getTrendingEvents(clientIp, registry.getMergedEnv(), query.country));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/suggested' && req.method === 'GET') {
      try {
        const clientIp = getClientIp(req);
        return sendJSON(res, 200, await suggestedRoutes.getSuggested(clientIp, registry.getMergedEnv(), query.country, query.category));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/concerts/categories' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await concertCategoriesRoutes.getConcertCategories(registry.getMergedEnv()));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/country-events' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await countryEventsRoutes.getCountryEvents(registry.getMergedEnv(), query.country));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/matches' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await matchesRoutes.getMatches(registry.getMergedEnv()));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/cities' && req.method === 'GET') {
      try {
        const clientIp = getClientIp(req);
        return sendJSON(res, 200, await citiesRoutes.getCitiesForVisitor(clientIp, query.country));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/events' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await eventRoutes.listUpcomingEvents(query));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/events\/type\/[^/]+$/) && req.method === 'GET') {
      const eventType = decodeURIComponent(pathname.split('/').pop());
      try {
        return sendJSON(res, 200, await eventRoutes.listEventsByType(eventType, query));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/events\/artist\/[^/]+$/) && req.method === 'GET') {
      const slug = decodeURIComponent(pathname.split('/').pop());
      try {
        return sendJSON(res, 200, await eventRoutes.listEventsByArtist(slug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/events\/venue\/[^/]+$/) && req.method === 'GET') {
      const slug = decodeURIComponent(pathname.split('/').pop());
      try {
        return sendJSON(res, 200, await eventRoutes.listEventsByVenue(slug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/events\/[^/]+$/) && req.method === 'GET') {
      const slug = decodeURIComponent(pathname.split('/').pop());
      try {
        return sendJSON(res, 200, await eventRoutes.getEvent(slug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/sports' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await sportsRoutes.listSports());
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/sports/leagues' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await sportsRoutes.listLeagues());
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/sports/teams' && req.method === 'GET') {
      try {
        return sendJSON(res, 200, await sportsRoutes.listTeams());
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/sports\/teams\/[^/]+$/) && req.method === 'GET') {
      const slug = decodeURIComponent(pathname.split('/').pop());
      try {
        return sendJSON(res, 200, await sportsRoutes.getTeam(slug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/sports\/matches\/[^/]+$/) && req.method === 'GET') {
      const slug = decodeURIComponent(pathname.split('/').pop());
      try {
        return sendJSON(res, 200, await sportsRoutes.getMatch(slug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/sports\/leagues\/[^/]+\/fixtures$/) && req.method === 'GET') {
      const slug = decodeURIComponent(pathname.split('/')[4]);
      try {
        return sendJSON(res, 200, await sportsRoutes.getLeagueFixtures(slug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    // Sport category pages (/football/, etc.) — every one of these is
    // scoped by :sportSlug straight through to the SQL query itself
    // (db/queries/sports.js), so a football page can never end up
    // showing baseball/basketball data even once those exist, let alone
    // concerts. See routes/sports.js's comment above these three
    // functions for the full reasoning.
    if (pathname.match(/^\/api\/sports\/[^/]+\/matches$/) && req.method === 'GET') {
      const sportSlug = decodeURIComponent(pathname.split('/')[3]);
      try {
        return sendJSON(res, 200, await sportsRoutes.getSportMatches(sportSlug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/sports\/[^/]+\/suggested$/) && req.method === 'GET') {
      const sportSlug = decodeURIComponent(pathname.split('/')[3]);
      try {
        return sendJSON(res, 200, await sportsRoutes.getSportSuggested(sportSlug));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname.match(/^\/api\/sports\/[^/]+\/search$/) && req.method === 'GET') {
      const sportSlug = decodeURIComponent(pathname.split('/')[3]);
      try {
        return sendJSON(res, 200, await sportsRoutes.searchSportMatches(sportSlug, {
          q: query.q,
          city: query.city,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
        }));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/api/watchers' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        return sendJSON(res, 200, watcherRoutes.createWatcher(body));
      } catch (err) {
        return sendJSON(res, err.statusCode || 500, { error: err.message });
      }
    }
    if (pathname === '/unsubscribe' && req.method === 'GET') {
      const result = watcherRoutes.unsubscribe(query.id, query.token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(result.ok
        ? '<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:15vh auto;text-align:center;"><h2>You\'re unsubscribed</h2><p>You won\'t get any more price alerts for this event.</p></body></html>'
        : `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:15vh auto;text-align:center;"><h2>Couldn't unsubscribe</h2><p>${result.error}</p></body></html>`);
      return;
    }
    if (pathname.startsWith('/admin/api/')) {
      return handleAdminApi(req, res, pathname, query);
    }
    if (pathname === '/admin' || pathname === '/admin/') {
      return serveFile(res, ADMIN_ROOT, 'admin.html');
    }
    // Real, indexable, deterministic city landing pages —
    // /events/{city-slug}/concerts/page/{n}/ and
    // /events/{city-slug}/page/{n}/ FIRST (real pagination URLs, not
    // query params — each page is genuinely different real content, so
    // each gets its own indexable URL per the spec's "search/filter
    // URLs should not become separate canonical SEO pages" rule not
    // actually applying here — this isn't a filter, it's real content
    // pagination), then /events/{city-slug}/concerts/ and
    // /events/{city-slug}/ (page 1, implicit) — all checked BEFORE the
    // generic two-segment /events/{eventId}/{slug} route below, since
    // otherwise "/events/berlin/concerts/" would incorrectly attempt an
    // event lookup with eventId="berlin" (confirmed by direct testing
    // of the route order below before this fix — the two-segment event
    // match's regex genuinely does match "berlin"/"concerts" too, and
    // being checked first meant it always won). All four routes are
    // gated on the known SEO city list (data/seo-cities.js); an
    // unrecognized slug falls through unchanged (matches existing
    // single-segment static files like /events/view.html continuing to
    // work exactly as before). The city itself comes only from the URL
    // match, never from IP/geolocation — see routes/cityPage.js's
    // header comment.
    const cityConcertsPageNumMatch = pathname.match(/^\/events\/([^/.]+)\/concerts\/page\/(\d+)\/?$/);
    if (cityConcertsPageNumMatch && req.method === 'GET' && getSeoCityBySlug(decodeURIComponent(cityConcertsPageNumMatch[1]))) {
      try {
        const siteOrigin = `https://${req.headers.host || 'www.livefair24.com'}`;
        const result = await cityPageRoutes.renderCityConcertsPage(decodeURIComponent(cityConcertsPageNumMatch[1]), registry.getMergedEnv(), siteOrigin, parseInt(cityConcertsPageNumMatch[2], 10));
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Page not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      } catch (err) {
        console.error('[city concerts page - paginated]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
    }
    const cityPageNumMatch = pathname.match(/^\/events\/([^/.]+)\/page\/(\d+)\/?$/);
    if (cityPageNumMatch && req.method === 'GET' && getSeoCityBySlug(decodeURIComponent(cityPageNumMatch[1]))) {
      try {
        const siteOrigin = `https://${req.headers.host || 'www.livefair24.com'}`;
        const result = await cityPageRoutes.renderCityAllEventsPage(decodeURIComponent(cityPageNumMatch[1]), registry.getMergedEnv(), siteOrigin, parseInt(cityPageNumMatch[2], 10));
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Page not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      } catch (err) {
        console.error('[city page - paginated]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
    }
    const cityConcertsMatch = pathname.match(/^\/events\/([^/.]+)\/concerts\/?$/);
    if (cityConcertsMatch && req.method === 'GET' && getSeoCityBySlug(decodeURIComponent(cityConcertsMatch[1]))) {
      try {
        const siteOrigin = `https://${req.headers.host || 'www.livefair24.com'}`;
        const result = await cityPageRoutes.renderCityConcertsPage(decodeURIComponent(cityConcertsMatch[1]), registry.getMergedEnv(), siteOrigin);
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('City not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      } catch (err) {
        console.error('[city concerts page]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
    }
    const cityPageMatch = pathname.match(/^\/events\/([^/.]+)\/?$/);
    if (cityPageMatch && req.method === 'GET' && getSeoCityBySlug(decodeURIComponent(cityPageMatch[1]))) {
      try {
        const siteOrigin = `https://${req.headers.host || 'www.livefair24.com'}`;
        const result = await cityPageRoutes.renderCityAllEventsPage(decodeURIComponent(cityPageMatch[1]), registry.getMergedEnv(), siteOrigin);
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('City not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      } catch (err) {
        console.error('[city page]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
    }
    // Real, indexable event pages — /events/{eventId}/{slug}. Two path
    // segments after /events/ specifically, so this never collides with
    // existing single-segment static files like /events/view.html or
    // /events/nova-wren-berlin-2026-08-16.html. Checked AFTER the city
    // routes above — see their comment for why the order matters here.
    const eventPageMatch = pathname.match(/^\/events\/([^/]+)\/([^/]+)\/?$/);
    if (eventPageMatch && req.method === 'GET') {
      const [, eventId, requestedSlug] = eventPageMatch;
      try {
        const siteOrigin = `https://${req.headers.host || 'www.livefair24.com'}`;
        const result = await eventPageRoutes.renderEventPage(
          decodeURIComponent(eventId),
          decodeURIComponent(requestedSlug),
          registry.getMergedEnv(),
          siteOrigin
        );
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('Event not found');
        }
        // Redirect to the canonical slug rather than serving duplicate
        // content under two URLs for the same real event.
        if (result.canonicalSlug !== requestedSlug) {
          res.writeHead(301, { Location: `/events/${encodeURIComponent(eventId)}/${result.canonicalSlug}` });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      } catch (err) {
        console.error('[event page]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
    }
    // Real, indexable artist hub pages — /artists/{attractionId}/{slug}.
    // Resolved by Ticketmaster's own attractionId, same convention as
    // /events/{eventId}/{slug} below — not a keyword re-search of the
    // slug (see routes/artistPage.js's header comment for the confirmed
    // real case, "2. Hamburg Festival 2026", that motivated this: a
    // fresh keyword search of a deslugified name isn't reliable for
    // unusual titles). Two path segments required after /artists/, same
    // reasoning as the /events/ pattern below: never collides with
    // existing single-segment static files like /artists/nova-wren.html,
    // and the bare /artists/ browse page doesn't match either since both
    // segments are required — both fall through to serveStatic,
    // completely unaffected by this route.
    const artistPageMatch = pathname.match(/^\/artists\/([^/]+)\/([^/]+)\/?$/);
    if (artistPageMatch && req.method === 'GET') {
      const [, attractionId, requestedSlug] = artistPageMatch;
      try {
        const siteOrigin = `https://${req.headers.host || 'www.livefair24.com'}`;
        const result = await artistPageRoutes.renderArtistPage(
          decodeURIComponent(attractionId),
          decodeURIComponent(requestedSlug),
          registry.getMergedEnv(),
          siteOrigin
        );
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('No upcoming events found for this artist');
        }
        if (result.canonicalSlug !== requestedSlug) {
          res.writeHead(301, { Location: `/artists/${encodeURIComponent(attractionId)}/${result.canonicalSlug}` });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      } catch (err) {
        console.error('[artist page]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
    }
    const venuePageMatch = pathname.match(/^\/venues\/([^/.]+)\/?$/);
    if (venuePageMatch && req.method === 'GET') {
      const [, slug] = venuePageMatch;
      try {
        const siteOrigin = `https://${req.headers.host || 'www.livefair24.com'}`;
        const result = await venuePageRoutes.renderVenuePage(decodeURIComponent(slug), registry.getMergedEnv(), siteOrigin);
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('No upcoming events found for this venue');
        }
        if (result.canonicalSlug !== slug) {
          res.writeHead(301, { Location: `/venues/${encodeURIComponent(result.canonicalSlug)}/` });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(result.html);
      } catch (err) {
        console.error('[venue page]', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('Server error');
      }
    }
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('Unhandled error:', err);
    return sendJSON(res, 500, { error: 'Internal server error' });
  }
});

(async () => {
  // Load persisted state (DynamoDB or local file, see persistence.js)
  // before accepting any requests.
  await configStore.init();
  await watchersStore.init();

  server.listen(port, () => {
    console.log(`LiveFair24 server running on http://localhost:${port}`);
    console.log('Public API:  /api/tickets   /api/hotels   /api/watchers   /api/health');
    console.log(`Admin panel: http://localhost:${port}/admin`);
    console.log(`Storage:     ${persistence.isUsingDynamo() ? 'DynamoDB (' + process.env.DYNAMODB_TABLE + ')' : 'local file (backend/data/)'}`);
    // Fire-and-forget — proactively keeps trending data warm on a
    // schedule so real visitors never wait for the slow discovery+
    // verification pipeline themselves. Started after listen() begins,
    // not awaited, so it never delays the server actually coming up.
    trendingRoutes.startBackgroundTrendingRefresh();
    concertCategoriesRoutes.startBackgroundConcertCategoriesRefresh();
    matchesRoutes.startBackgroundMatchesRefresh();
    cityPageRoutes.startBackgroundCityPagesRefresh();
    countryEventsRoutes.startBackgroundCountryEventsRefresh();
  });

  // Price-drop alert scheduler — re-checks every watched event once an hour.
  // Also runs once shortly after startup so a fresh signup during local
  // testing doesn't have to wait an hour to see the flow work.
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;
  setTimeout(() => runPriceCheck().catch((e) => console.error('[price-check]', e)), 15 * 1000);
  setInterval(() => runPriceCheck().catch((e) => console.error('[price-check]', e)), CHECK_INTERVAL_MS);
})();