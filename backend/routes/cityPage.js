// routes/cityPage.js
//
// Server-side rendering for real, indexable city landing pages at
// /events/{city-slug}/ — the core gap identified in the SEO
// architecture spec: nothing on the site served a deterministic city
// URL independent of the visitor's IP. /api/cities and /cities/germany/
// (routes/cities.js, countryEvents.js) are IP/country-driven — correct
// for the interactive "browse by city" UI, but exactly what the spec
// says must NOT be the mechanism deciding what Google can crawl. This
// route is the deliberate second, independent path: the city comes
// from data/seo-cities.js — a real record, matched against the URL
// path — never from IP detection. A visitor (or Googlebot) requesting
// /events/dresden/ from Germany, the US, or anywhere else gets the
// identical Dresden page; nothing here ever redirects based on
// geolocation.
//
// Pilot scope only (spec section 35) — only the 3 cities in
// data/seo-cities.js get a real page; server.js's route match checks
// against that same list, so an unknown slug 404s rather than
// rendering an empty shell.

const registry = require('../providers/registry');
const { getSeoCityBySlug } = require('../data/seo-cities');

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — same reasoning as countryEvents.js
const cache = new Map(); // slug -> { html, expiresAt }

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function slugify(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildEventSlug(ev) {
  const parts = [ev.name, ev.city, ev.date].filter(Boolean);
  return slugify(parts.join('-')) || 'event';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function formatDate(dateStr, timeStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  const dayLabel = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return timeStr ? `${dayLabel} \u00b7 ${timeStr.slice(0, 5)}` : dayLabel;
}

// Real events for this specific city, via Ticketmaster's own `city`
// search parameter — deliberately NOT the visitor's IP/detected
// country in any way. Same real search endpoint /search/ already uses,
// just called server-side so the results land in the initial HTML
// instead of requiring client-side JS to fetch and render them (spec
// sections 6, 12, 29).
async function fetchRealEventsForCity(cityRecord, env) {
  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  if (!tm || typeof tm.searchEvents !== 'function') return [];
  const results = await tm.searchEvents(
    { query: '', city: cityRecord.name, countryCode: cityRecord.countryCode, limit: 50 },
    env
  );
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  const events = [];
  for (const ev of results) {
    if (!ev.eventId || seen.has(ev.eventId) || !ev.name || !ev.date) continue;
    seen.add(ev.eventId);
    events.push({ ...ev, slug: buildEventSlug(ev) });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return events;
}

function buildVenueSection(events) {
  const byVenue = new Map();
  for (const ev of events) {
    if (!ev.venue) continue;
    if (!byVenue.has(ev.venue)) byVenue.set(ev.venue, { name: ev.venue, count: 0 });
    byVenue.get(ev.venue).count += 1;
  }
  return Array.from(byVenue.values()).sort((a, b) => b.count - a.count).slice(0, 8);
}

function eventCardHtml(ev) {
  const href = `/events/${encodeURIComponent(ev.eventId)}/${encodeURIComponent(ev.slug)}`;
  const dateLine = formatDate(ev.date, ev.time);
  const metaLine = [ev.venue, ev.city].filter(Boolean).map(escapeHtml).join(', ');
  const priceLine = ev.lowestPrice != null
    ? `From ${escapeHtml(ev.currency || '')}${ev.lowestPrice}`
    : 'Tickets available';
  return `
    <a href="${href}" class="card event-card" style="text-decoration:none;display:block;padding:20px;">
      <h3 style="margin-bottom:4px;"><a href="${href}" style="color:inherit;text-decoration:none;">${escapeHtml(ev.name)}</a></h3>
      <div class="meta">${metaLine}</div>
      <div class="date">${escapeHtml(dateLine)}</div>
      <div class="card-foot"><span class="from">${priceLine}</span><span class="cta">View tickets \u2192</span></div>
    </a>`;
}

function venueRowHtml(venue, citySlug) {
  return `<a href="/search/?city=${encodeURIComponent(citySlug)}" class="card" style="padding:16px;display:block;text-decoration:none;">
    <div style="font-weight:800;font-size:15px;">${escapeHtml(venue.name)}</div>
    <div style="font-size:12.5px;color:var(--ink-dim);margin-top:4px;">${venue.count} upcoming event${venue.count === 1 ? '' : 's'}</div>
  </a>`;
}

// Returns { html } on success, or null if the slug isn't a known SEO
// city (caller should respond 404) — never renders an empty shell for
// an unrecognized slug.
async function renderCityPage(slug, env, siteOrigin) {
  const cityRecord = getSeoCityBySlug(slug);
  if (!cityRecord) return null;

  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return { html: cached.html };

  const events = await fetchRealEventsForCity(cityRecord, env);
  const venues = buildVenueSection(events);
  const canonicalUrl = `${siteOrigin}/events/${cityRecord.slug}/`;

  const eventListHtml = events.length > 0
    ? events.map(eventCardHtml).join('')
    : `<div style="padding:24px;color:var(--ink-faint);font-size:14.5px;grid-column:1/-1;">No current listings for ${escapeHtml(cityRecord.name)} \u2014 check back soon.</div>`;

  const venueSectionHtml = venues.length > 0 ? `
  <section class="section">
    <div class="section-header"><div><h2>Popular venues in ${escapeHtml(cityRecord.name)}</h2></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
      ${venues.map((v) => venueRowHtml(v, cityRecord.slug)).join('')}
    </div>
  </section>` : '';

  // Real ItemList structured data — only the events actually returned
  // above, real names/dates/URLs, no invented items to pad the list.
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: events.slice(0, 20).map((ev, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${siteOrigin}/events/${encodeURIComponent(ev.eventId)}/${encodeURIComponent(ev.slug)}`,
      name: ev.name,
    })),
  };
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteOrigin}/` },
      { '@type': 'ListItem', position: 2, name: 'Events', item: `${siteOrigin}/concerts/` },
      { '@type': 'ListItem', position: 3, name: cityRecord.name },
    ],
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${escapeHtml(cityRecord.seoTitle)}</title>
<meta name="description" content="${escapeHtml(cityRecord.seoDescription)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v=20260819p">
<meta property="og:title" content="${escapeHtml(cityRecord.seoTitle)}">
<meta property="og:description" content="${escapeHtml(cityRecord.seoDescription)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalUrl}">
<script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd)}</script>
${events.length > 0 ? `<script type="application/ld+json">${JSON.stringify(itemListJsonLd)}</script>` : ''}
</head>
<body>

<nav class="site-nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo"><span class="dot"></span>LiveFair24</a>
    <div class="nav-links" id="navLinks">
      <a href="/cities/">Browse cities</a>
      <a href="/concerts/">Concerts</a>
      <a href="/artists/">Artists</a>
      <a href="/venues/">Venues</a>
      <a href="/guides/how-it-works.html">How it works</a>
      <a href="/sports/index.html">Sports</a>
    </div>
    <div class="nav-right">
      <a href="/search/" class="nav-cta">Search concerts</a>
      <button class="nav-burger" id="navBurger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="navLinks">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</nav>
<script>
(function(){
  var btn=document.getElementById('navBurger'), links=document.getElementById('navLinks');
  if(!btn||!links) return;
  btn.addEventListener('click', function(){
    var open = links.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  links.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', function(){
      links.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
    });
  });
})();
</script>

<div class="breadcrumb">
  <div class="breadcrumb-inner">
    <a href="/">Home</a><span class="sep">\u203a</span>
    <a href="/concerts/">Events</a><span class="sep">\u203a</span>
    <span>${escapeHtml(cityRecord.name)}</span>
  </div>
</div>

<main>
<div class="container">

  <section style="padding:40px 0 24px;max-width:74ch;">
    <span class="badge badge-blue" style="margin-bottom:16px;">${escapeHtml(cityRecord.country)}</span>
    <h1 class="display" style="font-size:clamp(28px,4.5vw,48px);">Events in ${escapeHtml(cityRecord.name)}</h1>
    <p style="font-size:16px;color:var(--ink-dim);margin-top:14px;line-height:1.7;">${escapeHtml(cityRecord.seoIntro)}</p>
  </section>

  <section class="section" style="padding-top:0;">
    <div class="section-header"><div><h2>Upcoming events in ${escapeHtml(cityRecord.name)}</h2><p>Real, live ticket prices, updated every 2 minutes.</p></div></div>
    <div class="card-grid">
      ${eventListHtml}
    </div>
  </section>

  ${venueSectionHtml}

</div>
</main>

<footer class="site-footer">
  <div class="footer-inner">
    <div>
      <div class="footer-logo">\u25cf LiveFair24</div>
      <p class="footer-tagline">Concert ticket search + hotels + total trip cost.</p>
    </div>
    <div class="footer-col">
      <h4>Browse</h4>
      <ul>
        <li><a href="/cities/">All cities</a></li>
        <li><a href="/artists/">Artists</a></li>
        <li><a href="/venues/">Venues</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Guides</h4>
      <ul>
        <li><a href="/guides/how-it-works.html">How it works</a></li>
        <li><a href="/guides/hotels-near-venues.html">Hotels near venues</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Company</h4>
      <ul>
        <li><a href="/about.html">About</a></li>
        <li><a href="/affiliate-disclosure.html">Affiliate disclosure</a></li>
        <li><a href="/privacy.html">Privacy</a></li>
        <li><a href="/contact.html">Contact</a></li>
        <li><a href="/impressum.html">Impressum</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom"><span>\u00a9 2026 LiveFair24. We earn affiliate commission on purchases made through our links.</span></div>
</footer>

<script src="/js/cookie-banner.js" defer></script>
</body>
</html>`;

  cache.set(slug, { html, expiresAt: Date.now() + CACHE_TTL_MS });
  return { html };
}

module.exports = { renderCityPage };
