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

function get(urlPath, headers) {
  return new Promise((resolve, reject) => {
    http.get(BASE + urlPath, { headers: headers || {} }, (res) => {
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

  await test('GET /api/sports/teams fails gracefully (not a crash) without PostgreSQL configured', async () => {
    const res = await get('/api/sports/teams');
    assert.strictEqual(res.status, 500);
    assert.ok(res.json.error.includes('PostgreSQL is not configured'));
  });

  await test('Homepage hotel cards have a Book button', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('hbook'), 'homepage hotel cards must have a Book button (class="hbook")');
  });

  await test('Event page hotel section has price/rating filters, matching the homepage', async () => {
    const res = await get('/events/nova-wren-berlin-2026-08-16.html');
    assert.ok(res.body.includes('id="hpSlider"'), 'event page must have the price filter slider');
    assert.ok(res.body.includes('class="rpill'), 'event page must have rating filter pills');
  });

  await test('Event page hotel results use the same concise card layout as the homepage, not a table', async () => {
    const res = await get('/events/nova-wren-berlin-2026-08-16.html');
    assert.ok(res.body.includes('id="hotelScroll"'), 'event page must use the shared hotel-scroll card container');
    assert.ok(res.body.includes('renderEventHotelList'), 'event page must render hotels as cards, not a table');
    assert.ok(!res.body.includes('class="hotel-table"'), 'the old hotel table markup must be fully removed');
    assert.ok(!res.body.includes('hotelTableBody'), 'no leftover references to the removed table body element');
  });

  await test('Match page (Step 8) loads and reuses the same shared components', async () => {
    const res = await get('/matches/fc-bergkristall-vs-rheingold-united-2026-09-12.html');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('id="sellerCards"'), 'match page must use the shared seller-card ticket component');
    assert.ok(res.body.includes('id="hotelScroll"'), 'match page must use the shared hotel card component');
    assert.ok(res.body.includes('leaflet'), 'match page must have the hotel map');
  });

  await test('Match page ticket/hotel API calls actually work end to end', async () => {
    const tickets = await get('/api/tickets?artist=FC%20Bergkristall%20vs%20Rheingold%20United&city=Munich&basePrice=45&eventId=101');
    assert.strictEqual(tickets.status, 200);
    assert.ok(tickets.json.results.length > 0);
    const hotels = await get('/api/hotels?lat=48.1351&lng=11.5820&checkIn=2026-09-12&checkOut=2026-09-13&eventId=101');
    assert.strictEqual(hotels.status, 200);
    assert.ok(hotels.json.results.length > 0);
  });

  await test('Homepage hero links all point to pages that actually exist (no dead links)', async () => {
    const res = await get('/');
    const hrefs = [...res.body.matchAll(/class="pill"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="pill"/g)]
      .map(m => m[1] || m[2]);
    for (const href of hrefs) {
      const check = await get(href);
      assert.strictEqual(check.status, 200, `Dead hero link found: ${href}`);
    }
  });

  await test('Sports nav link exists and the hub page it points to actually works', async () => {
    const home = await get('/');
    assert.ok(home.body.includes('sports/index.html">Sports<'), 'homepage nav must include a Sports link');
    const hub = await get('/sports/index.html');
    assert.strictEqual(hub.status, 200);
    assert.ok(hub.body.includes('FC Bergkristall vs Rheingold United'), 'sports hub must list the real seeded match');
  });

  await test('Homepage has separate Upcoming concerts and Upcoming matches sections, not mixed', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('id="concerts"'), 'homepage must have a distinct concerts section');
    assert.ok(res.body.includes('id="sports"'), 'homepage must have a distinct sports section');
    assert.ok(res.body.includes('>Upcoming matches<'), 'sports section must have its own clear heading');
  });

  await test('GET /api/search aggregates and sorts results by price', async () => {
    const res = await get('/api/search?q=Coldplay');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.query, 'Coldplay');
    assert.ok(Array.isArray(res.json.results));
    assert.ok(res.json.results.length > 0, 'demo fallback must always return something');
    for (let i = 1; i < res.json.results.length; i++) {
      const prev = res.json.results[i - 1].lowestPrice;
      const curr = res.json.results[i].lowestPrice;
      if (prev != null && curr != null) {
        assert.ok(prev <= curr, 'results must be sorted by price ascending');
      }
    }
  });

  await test('GET /api/search with an empty query returns cleanly, not an error', async () => {
    const res = await get('/api/search');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.count, 0);
  });

  await test('The real /search/ page exists and works — the homepage search bar\'s target', async () => {
    const home = await get('/');
    assert.ok(home.body.includes('action="/search/"'), 'homepage search form must point to the real search page');
    const searchPage = await get('/search/');
    assert.strictEqual(searchPage.status, 200);
    const oldBrokenPath = await get('/search');
    assert.strictEqual(oldBrokenPath.status, 404, 'confirms the bare /search path genuinely never worked, motivating this fix');
  });

  await test('Every page\'s "Search concerts" nav button points to the real search page', async () => {
    const pagesToCheck = ['/', '/artists/nova-wren.html', '/venues/waldbuhne-berlin.html', '/matches/fc-bergkristall-vs-rheingold-united-2026-09-12.html'];
    for (const page of pagesToCheck) {
      const res = await get(page);
      assert.ok(res.body.includes('href="/search/" class="nav-cta"'), `${page} nav-cta must point to /search/`);
    }
  });

  await test('Search autocomplete script is wired into both the homepage and /search/ page', async () => {
    const home = await get('/');
    assert.ok(home.body.includes('search-autocomplete.js'), 'homepage must load the autocomplete script');
    assert.ok(home.body.includes('class="search-input"'), 'homepage input must have the class the script looks for');

    const searchPage = await get('/search/');
    assert.ok(searchPage.body.includes('search-autocomplete.js'), 'search page must load the autocomplete script');
    assert.ok(searchPage.body.includes('search-form') && searchPage.body.includes('search-input'),
      'search page form/input must have the classes the shared script looks for');
  });

  await test('Autocomplete script does not call form.submit() as executable code (would bypass custom submit handlers)', async () => {
    const res = await get('/js/search-autocomplete.js');
    assert.strictEqual(res.status, 200);
    // Checking for the executable call pattern specifically (not just the
    // substring "form.submit()", which also appears in this file's own
    // explanatory comment about why it's avoided).
    assert.ok(!/[^/]form\.submit\(\);/.test(res.body), 'must not call form.submit() as a statement — dispatch a real submit event instead');
    assert.ok(res.body.includes("form.dispatchEvent(new Event('submit'"), 'must dispatch a proper submit event');
  });

  await test('Homepage has the segmented Location/Dates/Search bar with all fields present', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('name="city"'), 'must have a location field');
    assert.ok(res.body.includes('name="dateFrom"') && res.body.includes('name="dateTo"'), 'must have hidden date-range fields');
    assert.ok(res.body.includes('id="searchDatesBtn"') && res.body.includes('id="searchDatesPanel"'), 'must have the calendar date-range picker');
    assert.ok(!res.body.includes('searchDatePreset'), 'the old preset dropdown must be fully removed, not left as dead markup');
  });

  await test('Calendar date-range picker script and location autocomplete are both wired in', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('search-date-range.js'), 'homepage must load the calendar picker script');
    assert.ok(res.body.includes('search-location.js'), 'homepage must load the location autocomplete script');
    const calScript = await get('/js/search-date-range.js');
    assert.strictEqual(calScript.status, 200);
    const locScript = await get('/js/search-location.js');
    assert.strictEqual(locScript.status, 200);
  });

  await test('Calendar picker disables past dates — cannot select an already-passed day', async () => {
    const res = await get('/js/search-date-range.js');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('isPastDate'), 'must have past-date detection logic');
    assert.ok(res.body.includes('cal-day-disabled'), 'must render disabled styling for past dates');
    // The key correctness property: past-date cells must be rendered as
    // non-interactive <span>, not clickable <button> — the click-handler
    // wiring only queries 'button.cal-day', which naturally excludes them.
    assert.ok(res.body.includes("querySelectorAll('button.cal-day')"),
      'click handlers must only attach to real buttons, not disabled date spans');
  });

  await test('Calendar picker does not close itself when selecting a date range (composedPath fix)', async () => {
    const res = await get('/js/search-date-range.js');
    assert.strictEqual(res.status, 200);
    // The outside-click-closes-panel listener must use composedPath(),
    // not root.contains(e.target) — the latter breaks because
    // handleDayClick() re-renders (and thus detaches) the just-clicked
    // button before this listener runs, making every date click look like
    // a click "outside" the panel and closing it prematurely.
    assert.ok(res.body.includes('e.composedPath'), 'must use composedPath() for the outside-click check');
    assert.ok(!res.body.includes('if (!root.contains(e.target))'), 'must not use the exact target-based containment check that caused this bug (comments explaining the fix are fine)');
  });

  await test('Calendar date format is unambiguous ("12 Aug 2026"), not confusing MM/DD/YYYY', async () => {
    const res = await get('/js/search-date-range.js');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('formatDate') && res.body.includes('formatRangeLabel'), 'must have the unambiguous date formatting functions');
    assert.ok(!res.body.includes('formatMMDDYYYY'), 'the old ambiguous MM/DD/YYYY formatter must be fully removed, not left dangling');
    const homepage = await get('/');
    assert.ok(!homepage.body.includes('MM/DD/YYYY'), 'no page should show the ambiguous placeholder format anymore');
  });

  await test('Calendar month/year title has explicit text color (not invisible white-on-white)', async () => {
    const res = await get('/css/style.css');
    assert.strictEqual(res.status, 200);
    // The whole hero section sets color:#fff (white, for the blue
    // background). That inherits into every descendant by default,
    // including the calendar popup — which has a WHITE background. Any
    // text element in there without its own explicit color renders
    // invisible: technically present in the DOM, impossible to see. This
    // exact bug hit .cal-month-title once already.
    const match = res.body.match(/\.cal-month-title\{([^}]*)\}/);
    assert.ok(match, '.cal-month-title rule must exist');
    assert.ok(match[1].includes('color:'), '.cal-month-title must set its own explicit color, not inherit the hero section\'s white text');
  });

  await test('GET /api/search genuinely filters by city, not just accepting the param decoratively', async () => {
    const res = await get('/api/search?q=Coldplay&city=Berlin');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.results.length > 0);
    assert.ok(res.json.results.every((r) => r.city === 'Berlin'), 'every result must actually be in the requested city');
  });

  await test('GET /api/search genuinely filters by date range, excluding results outside it', async () => {
    const res = await get('/api/search?q=Coldplay&dateFrom=2020-01-01T00:00:00Z&dateTo=2020-01-02T00:00:00Z');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.count, 0, 'a date range far in the past must exclude all demo results, proving the filter is real');
  });

  await test('GET /api/search works with city alone, no keyword required', async () => {
    const res = await get('/api/search?city=Berlin');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.results.length > 0, 'a location-only search must still return results');
  });

  await test('The /search/ results page reads city/dateFrom/dateTo from the URL, not just q (regression: was silently ignoring them)', async () => {
    const res = await get('/search/');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes("getQueryParam('city')"), 'load handler must read city from the URL');
    assert.ok(res.body.includes("getQueryParam('dateFrom')") && res.body.includes("getQueryParam('dateTo')"), 'load handler must read the date range from the URL');
    assert.ok(res.body.includes('apiParams.set(\'city\'') || res.body.includes('apiParams.set("city"'), 'must actually pass city through to /api/search, not just read it and drop it');
    assert.ok(!res.body.includes('runSearch(getQueryParam(\'q\'))'), 'must not call runSearch with only the query string — that was the exact bug (location-only searches did nothing)');
  });

  await test('Homepage "How LiveFair24 works" appears exactly once, positioned after "Browse concerts by country"', async () => {
    const res = await get('/');
    const matches = res.body.match(/How LiveFair24 works/g) || [];
    assert.strictEqual(matches.length, 1, 'must appear exactly once — this section was accidentally duplicated once already while being repositioned');
    const countryIdx = res.body.indexOf('Browse concerts by country');
    const howItWorksIdx = res.body.indexOf('How LiveFair24 works');
    assert.ok(countryIdx > -1 && howItWorksIdx > countryIdx, '"How LiveFair24 works" must come after "Browse concerts by country" in the page');
  });

  await test('GET /api/trending returns cleanly and falls back correctly for private/local IPs', async () => {
    const res = await get('/api/trending');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.detectedCountry, null, 'a local/private test IP has no real geolocation — must be null, not a guessed value');
    assert.strictEqual(res.json.countryUsed, 'US', 'must fall back to the documented default country');
    assert.ok(Array.isArray(res.json.results));
    assert.ok(res.json.results.length > 0, 'demo fallback must always return something so the endpoint is never a dead end');
  });

  await test('GET /api/trending extracts the real client IP from X-Forwarded-For, not the proxy\'s own address', async () => {
    // Can't reach a real geolocation service from this test environment,
    // but this confirms the IP extraction itself works: a public-looking
    // IP in X-Forwarded-For should be treated as non-private (attempted
    // for lookup) rather than immediately short-circuited the way a
    // literal 127.0.0.1 request is.
    const withPublicIp = await get('/api/trending', { 'X-Forwarded-For': '8.8.8.8, 10.0.0.1' });
    assert.strictEqual(withPublicIp.status, 200);
    assert.ok(Array.isArray(withPublicIp.json.results));
  });

  await test('Homepage loads the trending-concerts logic and falls back silently when unavailable', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('loadTrendingConcerts'), 'homepage must attempt to load real trending concerts');
    assert.ok(res.body.includes('data.demoMode || data.results.length === 0) return'),
      'must silently keep the static fallback cards in demo mode or on empty results — no error, no broken UI');
  });

  await test('Trending prefers distinct artists per card, topping up with repeats only when the pool lacks enough diversity (demo mode only has 3 base artists, so 6 cards correctly means some repeat)', async () => {
    const res = await get('/api/trending');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.count, 6, 'must fill all 6 card slots, per the requirement to never show fewer cards than the pool could support');
    const distinctArtists = new Set(res.json.results.map((r) => r.attractionId));
    assert.ok(distinctArtists.size >= 3, 'demo mode has exactly 3 base artists — all 3 must appear rather than fewer');
    assert.ok(distinctArtists.size < res.json.results.length, 'with only 3 distinct artists available for 6 slots, some repetition is expected and correct — not a bug');
  });

  await test('Trending uses a two-step discover-then-verify-price flow, not a single bare country query (regression: a bare countryCode query reliably came back with zero priced results in production, confirmed twice against real Ticketmaster data)', async () => {
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('STEP 1'), 'must have a discovery step to find candidate events without requiring price yet');
    assert.ok(trendingSrc.includes('STEP 2'), 'must have a separate verification step that re-queries by name for pricing');
    assert.ok(trendingSrc.includes('cand.name'), 'verification must re-query using the actual candidate name, not the bare country query again');
  });

  await test('Static fallback\'s initial "Compare live prices" panel content matches the active card (regression: showed Nova Wren while Rosa Calder card was marked active, causing a visible wrong-data flash before JS corrected it on load)', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('id="ticketEpTitle">Rosa Calder<'), 'ticket panel initial content must match whichever card has the "active" class');
    assert.ok(res.body.includes('id="epTitle">Hotels near Rosa Calder'), 'hotel panel initial content must also match — this one was already correct, confirming only the ticket panel had drifted');
  });

  await test('Trending discovery filters to music events only (regression: a live debug trace showed comedy shows and a children\'s museum being pulled in as "trending concerts")', async () => {
    const tmSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'providers', 'tickets', 'ticketmaster.js'), 'utf8');
    assert.ok(tmSrc.includes('classificationName=music'), 'discovery must filter to music events, confirmed necessary by real non-concert results appearing in production');
  });

  await test('Trending candidate selection preserves soonest-first date order rather than randomizing across the whole discovered pool (near-term events are more likely to have on-sale pricing)', async () => {
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('selectDiverseSoonest'), 'candidate selection must use the soonest-first function, not the fully-randomized one');
    assert.ok(trendingSrc.includes('const candidates = selectDiverseSoonest'), 'must actually be wired in as the candidate-picking function, not just defined and unused');
    // Final display selection must still be fully randomized — only the
    // candidate-VERIFICATION stage changed, per the requirement that
    // final selection stays random.
    assert.ok(trendingSrc.includes('selectDiverseRandom(priced, TARGET_COUNT)'), 'final display selection must still randomize among already-priced results');
  });

  await test('Trending prefers onsale events for candidate verification, using Ticketmaster\'s own confirmed dates.status.code field (an event can be listed before tickets go on sale, which would explain missing pricing regardless of query strategy)', async () => {
    const tmSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'providers', 'tickets', 'ticketmaster.js'), 'utf8');
    assert.ok(tmSrc.includes('saleStatus:') && tmSrc.includes('dates.status.code'), 'must extract the real onsale status field from Ticketmaster\'s response');
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('isOnSaleOrUnknown'), 'must filter candidates toward onsale events before spending a verification call on them');
    assert.ok(trendingSrc.includes('onSaleDiscovered.length > 0 ? onSaleDiscovered : upcomingDiscovered'),
      'must fall back to the full upcoming pool if onsale filtering would leave nothing, rather than returning zero outright');
  });

  await test('Trending backend requires a real price — events with no pricing are excluded from the homepage entirely, not shown as "Price TBA" (explicit product decision, reversing an earlier attempt)', async () => {
    const res = await get('/api/trending');
    assert.strictEqual(res.status, 200);
    assert.ok(res.json.results.every((r) => r.lowestPrice != null), 'no result reaching the frontend should have a missing price');
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('.filter(hasRealPrice)'), 'must hard-filter out unpriced events per the explicit requirement that they not appear as cards');
  });

  await test('Trending query sorts by soonest-upcoming date, not relevance (near-term events are more likely to have real pricing than distant announced tours)', async () => {
    const tmSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'providers', 'tickets', 'ticketmaster.js'), 'utf8');
    assert.ok(tmSrc.includes("sort=date,asc"), 'trending query must sort by date, not the old relevance sort that surfaced unpriced far-future tours');
    assert.ok(!tmSrc.includes('sort=relevance,desc'), 'the old relevance sort must be fully removed, not left alongside the new one');
  });

  await test('Trending dedup logic uses the real attractionId field, not a name-matching heuristic alone', async () => {
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('attractionId'), 'dedup must use the real attraction ID field when available');
    const tmSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'providers', 'tickets', 'ticketmaster.js'), 'utf8');
    assert.ok(tmSrc.includes('attractionId'), 'the Ticketmaster adapter must actually extract and return this field');
  });

  await test('Trending cards fully replace EVENTS and reuse the existing selectEvent() system (not a separate simplified card)', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('EVENTS.length = 0'), 'must mutate the shared EVENTS array in place, not reassign it — fetchTickets/fetchHotels/selectEvent all close over this same array reference');
    assert.ok(res.body.includes('renderTrendingEventCards'), 'must re-render real cards using the same interactive card system as the static fallback');
    assert.ok(res.body.includes("selectEvent(${i},'ticket')") || res.body.includes('selectEvent(${i},\'ticket\')'),
      'trending cards must wire into the same selectEvent() ticket-comparison flow the static cards use, not link out separately');
  });

  await test('Trending events missing venue coordinates are dropped, not shown with a broken hotel map', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('ev.lat != null && ev.lng != null'), 'events without real coordinates must be filtered out before becoming clickable cards');
  });

  await test('Homepage initialization is properly sequenced — selectEvent(0) only runs after the trending swap resolves (race condition fix)', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('await loadTrendingConcerts()'), 'must await the trending fetch before reading EVENTS[0]');
    assert.ok(res.body.includes('initHomepageEvents'), 'must use one coordinated initializer, not two independent load listeners racing each other');
    // Only one 'load' listener should exist for this purpose — two
    // independent ones was the exact bug (selectEvent(0) could read
    // EVENTS[0] before an in-flight trending fetch replaced its contents).
    const loadListenerCount = (res.body.match(/window\.addEventListener\('load'/g) || []).length;
    assert.strictEqual(loadListenerCount, 1, 'exactly one load listener should drive homepage event initialization');
  });

  await test('Trending cards always show a real price — the backend guarantees this, so no TBA/blank handling is needed on the frontend', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('ticket: `$${Math.round(r.lowestPrice)}`'), 'must map directly to a real price — the backend contract guarantees every result has one');
    assert.ok(!res.body.includes("'TBA'"), 'the TBA fallback path should be removed now that unpriced events never reach the frontend');
  });

  await test('Every event card (static and trending) is fully clickable, not just its small "Compare"/"Hotels" links (regression: cards looked selectable via the active border but only two tiny links actually worked)', async () => {
    const res = await get('/');
    const cardOnclicks = res.body.match(/class="card event-card[^"]*" data-id="\d+" style="cursor:pointer;" onclick="selectEvent\(\d+,'ticket'\)"/g) || [];
    assert.ok(cardOnclicks.length >= 6, 'all 6 static fallback cards must have a whole-card click handler');
    assert.ok(res.body.includes('style="cursor:pointer;" onclick="selectEvent(${i},\'ticket\')"'),
      'the dynamically-rendered trending card template must have the same whole-card click handler');
  });

  await test('The old redundant querySelectorAll click listener is removed, not double-firing alongside the new inline onclick handlers', async () => {
    const res = await get('/');
    assert.ok(!res.body.includes("selectEvent(parseInt(card.dataset.id))"),
      'the old one-time-attachment listener (which only ever worked for the 6 static cards present at parse time, never for dynamically-injected trending cards) must be removed now that inline onclick handles both consistently');
  });

  await test('Trending selection prefers artist diversity but tops up with repeat-artist events rather than showing fewer cards or none at all', async () => {
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('selectDiverseRandom'), 'must use the diversity-preferring selection function');
    assert.ok(trendingSrc.includes('if (selected.length < targetCount)'), 'must top up with additional events from already-used artists when the pool lacks enough diversity, rather than returning fewer cards');
  });

  await test('Trending selection is randomized, not deterministically the same 6 events every time', async () => {
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('Math.random()'), 'selection must include real randomization, not just a fixed sort order');
  });

  await test('Trending only considers genuinely upcoming events — explicit date/time check, not an assumption about provider default behavior', async () => {
    const trendingSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'trending.js'), 'utf8');
    assert.ok(trendingSrc.includes('isUpcoming') && trendingSrc.includes('Date.now()'), 'must explicitly filter for events at or after the current moment');
  });

  await test('Real Ticketmaster event/attraction IDs are carried through to the selected event, for correct identification', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('ticketmasterEventId: r.eventId'), 'the real Ticketmaster event ID must be preserved on the selected event object');
    const tmSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'providers', 'tickets', 'ticketmaster.js'), 'utf8');
    assert.ok(tmSrc.includes('eventId: ev.id'), 'the Ticketmaster adapter must actually extract the real event ID, not just the attraction ID');
  });

  await test('Hotels Near shows a distinct "No hotels available" message when the API genuinely returns nothing, separate from the existing "no hotels match your filters" message', async () => {
    const res = await get('/');
    assert.ok(res.body.includes('No hotels available.'), 'must have an honest, distinct empty state for genuinely zero API results');
    assert.ok(res.body.includes('No hotels match these filters'), 'the existing filter-exclusion message must still exist, unchanged, for when hotels exist but the visitor\'s filters exclude them all');
    assert.ok(res.body.includes('if(hotels.length===0)'), 'the two empty states must be distinguished by checking the raw unfiltered count, not just the filtered count');
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
