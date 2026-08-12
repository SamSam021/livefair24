// test/regression.js
//
// Regression tests for existing functionality, per Section 83 Step 3 of
// the platform spec: "Create regression tests" before adding anything new.
//
// Zero new dependencies — uses Node's built-in http/assert. Starts the
// real server as a child process, hits real endpoints, checks real
// responses. Run with: node test/regression.js
//
// Exit code 0 = all passed. Non-zero = something regressed — do not
// proceed to new feature work until this is green again.

const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3999; // dedicated test port, won't collide with a dev server on 3000
const BASE = `http://localhost:${PORT}`;

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(BASE + urlPath, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* not JSON, that's fine for HTML routes */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    }).on('error', reject);
  });
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(
      BASE + urlPath,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let respData = '';
        res.on('data', (c) => (respData += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(respData); } catch (e) {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await get('/api/health');
      if (res.status === 200) return true;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become ready in time');
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function runTests() {
  console.log('Existing functionality regression tests\n');

  await test('GET /api/health returns ok', async () => {
    const res = await get('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.ok, true);
  });

  await test('GET /api/tickets returns demo results with expected shape', async () => {
    const res = await get('/api/tickets?artist=Test&city=Berlin&basePrice=50&eventId=1');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.demoMode, true);
    assert.ok(Array.isArray(res.json.results));
    assert.ok(res.json.results.length > 0, 'demo mode should always return at least one seller');
    const first = res.json.results[0];
    assert.ok(typeof first.total === 'number');
    assert.ok(typeof first.sellerName === 'string');
    assert.strictEqual(first.isBestPrice, true, 'cheapest result should be flagged as best price');
  });

  await test('GET /api/hotels returns demo results with expected shape', async () => {
    const res = await get('/api/hotels?lat=52.52&lng=13.405&checkIn=2026-08-16&checkOut=2026-08-17&eventId=1');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.demoMode, true);
    assert.ok(Array.isArray(res.json.results));
    assert.ok(res.json.results.length > 0);
    const first = res.json.results[0];
    assert.ok(typeof first.pricePerNight === 'number');
    assert.ok(typeof first.name === 'string');
  });

  await test('POST /api/watchers rejects an invalid email', async () => {
    const res = await post('/api/watchers', { email: 'not-an-email', eventId: 1, artist: 'Test', initialPrice: 50 });
    assert.strictEqual(res.status, 400);
  });

  await test('POST /api/watchers accepts a valid signup', async () => {
    const res = await post('/api/watchers', {
      email: 'regression-test@example.com', eventId: 1, artist: 'Test', venue: 'Test Venue',
      city: 'Berlin', eventUrl: '/events/test.html', initialPrice: 50,
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.ok, true);
    assert.ok(typeof res.json.id === 'string');
  });

  await test('GET /unsubscribe rejects an invalid token', async () => {
    const res = await get('/unsubscribe?id=w_doesnotexist&token=wrong');
    assert.strictEqual(res.status, 200); // returns an HTML page either way
    assert.ok(res.body.includes("Couldn't unsubscribe"));
  });

  await test('Homepage loads and includes the cookie banner script', async () => {
    const res = await get('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('cookie-banner.js'));
  });

  await test('Homepage loads and includes the Leaflet map', async () => {
    const res = await get('/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('leaflet'), 'homepage map (Leaflet) must still be present');
  });

  await test('Event detail page loads', async () => {
    const res = await get('/events/nova-wren-berlin-2026-08-16.html');
    assert.strictEqual(res.status, 200);
  });

  await test('Event detail page now includes a live map (Step 6 improvement)', async () => {
    const res = await get('/events/nova-wren-berlin-2026-08-16.html');
    assert.ok(res.body.includes('leaflet'), 'event page must load Leaflet');
    assert.ok(res.body.includes('eventHotelMap'), 'event page must have the map container');
    assert.ok(!res.body.includes('Central Hotel Berlin'), 'static fabricated hotel data must be removed, replaced by live fetch');
  });

  await test('Event detail page ticket table is now live, not fabricated', async () => {
    const res = await get('/events/nova-wren-berlin-2026-08-16.html');
    assert.ok(res.body.includes('priceTableBody'), 'event page must have a dynamic price table container');
    assert.ok(res.body.includes('fetchEventTickets'), 'event page must fetch real ticket data');
    assert.ok(!res.body.includes('$66.20'), 'fabricated static ticket price must be removed');
    assert.ok(!res.body.includes('Gigtree Exchange'), 'fabricated static seller row must be removed');
    assert.ok(!res.body.includes('30-day average'), 'fabricated price-history stats (no real history tracking exists) must be removed');
  });

  await test('Homepage map marker uses a real icon, not an emoji (Section 40)', async () => {
    const res = await get('/');
    assert.ok(!res.body.includes('🎤'), 'venue marker must not use emoji per the professional-icon requirement');
  });

  await test('No decorative emoji anywhere in the static site (Section 40)', async () => {
    // Star (★) and checkmark (✓) are excluded — conventional rating/status
    // symbols, not decorative pictograph emoji, and used deliberately for
    // ratings throughout the site.
    const fs = require('fs');
    const pathMod = require('path');
    const siteRoot = pathMod.join(__dirname, '..', '..', 'fairlive-site');
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    const flagPattern = /^[\u{1F1E6}-\u{1F1FF}]+$/u;
    const allowedSymbols = new Set(['★', '☆', '✓', '✗', '✔', '✕']); // conventional rating/status symbols, not decorative emoji

    function walk(dir) {
      let out = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = pathMod.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walk(full));
        else if (entry.name.endsWith('.html')) out.push(full);
      }
      return out;
    }

    const offenders = [];
    for (const file of walk(siteRoot)) {
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(new RegExp(emojiPattern, 'gu')) || [];
      const real = matches.filter((m) => !flagPattern.test(m) && !allowedSymbols.has(m));
      if (real.length > 0) offenders.push(`${pathMod.relative(siteRoot, file)}: ${real.join(' ')}`);
    }
    assert.strictEqual(offenders.length, 0, `Emoji found:\n${offenders.join('\n')}`);
  });

  await test('Impressum page loads with real content', async () => {
    const res = await get('/impressum.html');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('TMG'), 'legally required TMG reference must be present');
  });

  await test('Privacy page loads', async () => {
    const res = await get('/privacy.html');
    assert.strictEqual(res.status, 200);
  });

  await test('Admin panel requires authentication', async () => {
    const res = await get('/admin/api/config');
    assert.strictEqual(res.status, 401, 'admin config must not be readable without login');
  });

  await test('Admin login rejects wrong password', async () => {
    const res = await post('/admin/api/login', { password: 'definitely-wrong' });
    assert.strictEqual(res.status, 401);
  });

  await test('robots.txt and sitemap.xml are served', async () => {
    const robots = await get('/robots.txt');
    const sitemap = await get('/sitemap.xml');
    assert.strictEqual(robots.status, 200);
    assert.strictEqual(sitemap.status, 200);
  });

  await test('Server starts successfully even without pg installed/configured (Step 7)', async () => {
    // If this test file is even running, the server already started
    // successfully — this test exists to make that requirement explicit
    // and named, so a future change that reintroduces a top-level
    // require('pg') (breaking the whole server on startup) gets caught
    // immediately rather than discovered as "nothing works" later.
    const res = await get('/api/health');
    assert.strictEqual(res.status, 200);
  });

  await test('GET /api/events fails gracefully (not a crash) without PostgreSQL configured', async () => {
    const res = await get('/api/events');
    assert.strictEqual(res.status, 500);
    assert.ok(res.json.error.includes('PostgreSQL is not configured'));
  });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('\nFAILURES (do not proceed to new features until these are fixed):');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.error}`));
    process.exitCode = 1;
  }
}

// Start the real server as a child process, run tests against it, then kill it.
const serverPath = path.join(__dirname, '..', 'server.js');
const serverProcess = spawn('node', [serverPath], {
  env: { ...process.env, PORT: String(PORT), ADMIN_PASSWORD: 'regression-test-password' },
  stdio: 'pipe',
});

serverProcess.on('error', (err) => {
  console.error('Failed to start server for testing:', err.message);
  process.exit(1);
});

waitForServer()
  .then(runTests)
  .catch((err) => {
    console.error('Test run failed to start:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    serverProcess.kill();
  });
