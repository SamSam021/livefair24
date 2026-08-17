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
      return sendJSON(res, 200, { ok: true, buildMarker: 'distance-filter-added-v4' });
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
    // Real, indexable event pages — /events/{eventId}/{slug}. Two path
    // segments after /events/ specifically, so this never collides with
    // existing single-segment static files like /events/view.html or
    // /events/nova-wren-berlin-2026-08-16.html.
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
  });

  // Price-drop alert scheduler — re-checks every watched event once an hour.
  // Also runs once shortly after startup so a fresh signup during local
  // testing doesn't have to wait an hour to see the flow work.
  const CHECK_INTERVAL_MS = 60 * 60 * 1000;
  setTimeout(() => runPriceCheck().catch((e) => console.error('[price-check]', e)), 15 * 1000);
  setInterval(() => runPriceCheck().catch((e) => console.error('[price-check]', e)), CHECK_INTERVAL_MS);
})();