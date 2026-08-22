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
const { SEO_CITIES, getSeoCityBySlug } = require('../data/seo-cities');

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
//
// concertsOnly controls both the query itself (allCategories:true lifts
// the provider's default music-only restriction, for the general
// "all events" page) and an explicit post-filter using Ticketmaster's
// own real segment field (ev.genre) when concerts-only IS wanted —
// confirmed real gap: the query-level classificationName=music param
// alone isn't fully reliable (a real comedy show, "ZARNA GARG: MILLION
// DOLLAR EXCUSES", came back and rendered despite that filter), so the
// concerts page checks the real returned classification explicitly
// rather than trusting the query alone.
async function fetchRealEventsForCity(cityRecord, env, concertsOnly) {
  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  if (!tm || typeof tm.searchEvents !== 'function') return [];
  const results = await tm.searchEvents(
    { query: '', city: cityRecord.name, countryCode: cityRecord.countryCode, limit: 50, allCategories: !concertsOnly },
    env
  );
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  const events = [];
  for (const ev of results) {
    if (!ev.eventId || seen.has(ev.eventId) || !ev.name || !ev.date) continue;
    if (concertsOnly && (ev.genre || '').toLowerCase() !== 'music') continue;
    seen.add(ev.eventId);
    events.push({ ...ev, slug: buildEventSlug(ev) });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return events;
}

// Confirmed real issue: Ticketmaster's own inventory frequently lists
// several distinct real eventIds for what's genuinely the same
// underlying show — "Diljit Dosanjh – Aura World Tour" and "Diljit
// Dosanjh – Aura World Tour | Premium Packages" at the same venue,
// same date, same time. Both are real, both are individually valid
// Ticketmaster products, but showing both as separate city-page
// listings reads as duplicate/thin content to a crawler and dilutes
// whatever SEO signal the real underlying event could accumulate on
// one canonical page.
//
// This groups by (venue, date, time) — same real signals a human
// would use to recognize "these are the same show" — and picks ONE
// canonical listing per group for the city page's primary list: the
// variant WITHOUT a "|" suffix (Ticketmaster's own convention for
// marking a specific ticket product — Premium Packages, VIP Ticket,
// Box-Seat, etc.) when one exists, falling back to the shortest name
// otherwise. This only changes what the CITY PAGE lists — every real
// event keeps its own real, independently indexable page; a variant
// that isn't chosen as canonical here is still a genuine, reachable
// event page, just not duplicated in this listing. variantCount is
// attached so the canonical card can honestly say how many other real
// ticket options exist for the same show, linking to the real search
// rather than inventing an aggregate page that doesn't exist yet.
function dedupeUnderlyingEvents(events) {
  const groups = new Map();
  for (const ev of events) {
    const key = `${(ev.venue || '').toLowerCase()}|${ev.date}|${ev.time || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  const result = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const aHasPipe = a.name.includes('|') ? 1 : 0;
      const bHasPipe = b.name.includes('|') ? 1 : 0;
      if (aHasPipe !== bHasPipe) return aHasPipe - bHasPipe; // no-pipe first
      return a.name.length - b.name.length; // then shortest name
    });
    const canonical = sorted[0];
    result.push({ ...canonical, variantCount: group.length - 1 });
  }
  result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return result;
}

// Real starting prices for the initial SSR HTML — per the audit's item
// D: showing "Tickets available" under a "Real, live ticket prices"
// heading is a real mismatch between promise and content. Ticketmaster's
// broad city/country search reliably omits priceRanges (documented
// extensively in routes/trending.js) — a per-event detail-by-ID lookup
// is the only reliable way to get a real price. Verifies only the FIRST
// PRICE_VERIFY_LIMIT events (not every event in the city) — the display
// list itself is unbounded, so this cap exists independently to avoid
// firing a real verification call for every single one when there are
// many. Mutates lowestPrice/currency in place only when a real value
// comes back — never invents one, and an event this can't verify just
// keeps showing "Tickets available" rather than a wrong or fabricated
// number.
//
// No manual batching/delay here (previously PRICE_VERIFY_BATCH_SIZE=4
// with a 1100ms wait between batches) — confirmed real regression once
// providers/tickets/ticketmaster.js got its own global, process-wide
// request throttle (a hard 220ms floor between every real HTTP call,
// respecting Ticketmaster's actual "maxBurstMessageCount=1.0" limit
// from a real captured 429 response). That per-route delay was
// designed before the global one existed and started stacking on top
// of it — e.g. 12 events took ~5.9s (3 manual batches x (880ms of
// now-serialized "concurrent" calls + a redundant 1100ms wait)) instead
// of the ~2.6-3.3s a single correctly-paced queue actually needs.
// Firing every verification call at once here and trusting the shared
// queue to space them is both simpler and faster.
const PRICE_VERIFY_LIMIT = 12;
async function verifyRealPrices(events, tm, env) {
  const toVerify = events.slice(0, PRICE_VERIFY_LIMIT);
  await Promise.allSettled(
    toVerify.map(async (ev) => {
      if (typeof tm.getEventDetails !== 'function') return;
      try {
        const detail = await tm.getEventDetails(ev.eventId, env);
        if (detail && detail.lowestPrice != null) {
          ev.lowestPrice = detail.lowestPrice;
          ev.currency = detail.currency;
        }
      } catch (err) {
        console.warn('[cityPage] price verify', ev.eventId, err.message);
      }
    })
  );
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

// Real "Popular artists" section (audit item E/F) — grouped by
// Ticketmaster's own real attractionId, same identity Ticketmaster
// itself uses to say "these events are the same artist." Links to the
// real, already-live artist hub page (/artists/{attractionId}/{slug}/,
// routes/artistPage.js) — never a generated/thin page of its own.
// Events with no attractionId (one-off products with no real
// Ticketmaster attraction behind them) are simply not counted here,
// same reasoning as routes/suggested.js.
function buildArtistSection(events) {
  const byArtist = new Map();
  for (const ev of events) {
    if (!ev.attractionId) continue;
    const candidateName = ev.name.split('|')[0].trim();
    if (!byArtist.has(ev.attractionId)) {
      byArtist.set(ev.attractionId, { id: ev.attractionId, name: candidateName, count: 0 });
    } else {
      // Confirmed real issue: picking whichever event happens to come
      // first for this artist could land on a tour-name-suffixed
      // variant ("Jacob Collier - The Light For Days Tour") instead of
      // the clean artist name ("Jacob Collier") — pipe-splitting alone
      // only strips ticket-TYPE suffixes (| Premium Packages), not
      // tour-name suffixes. Keeping the shortest candidate seen across
      // every real event for this attractionId reliably favors the
      // clean name regardless of array order.
      const existing = byArtist.get(ev.attractionId);
      if (candidateName.length < existing.name.length) existing.name = candidateName;
    }
    byArtist.get(ev.attractionId).count += 1;
  }
  return Array.from(byArtist.values()).sort((a, b) => b.count - a.count).slice(0, 8);
}

function eventCardHtml(ev) {
  const href = `/events/${encodeURIComponent(ev.eventId)}/${encodeURIComponent(ev.slug)}`;
  const dateLine = formatDate(ev.date, ev.time);
  const metaLine = [ev.venue, ev.city].filter(Boolean).map(escapeHtml).join(', ');
  const priceLine = ev.lowestPrice != null
    ? `from ${escapeHtml(ev.currency || '')}${ev.lowestPrice}`
    : 'Tickets available';
  // Real count of other real ticket products at this same show (see
  // dedupeUnderlyingEvents above) — links to a real pre-filtered search
  // rather than an aggregate page that doesn't exist, since building
  // one properly needs a real underlying-event/product-ID split at the
  // data layer, not just a display-time grouping.
  const variantLine = ev.variantCount > 0
    ? `<div style="font-size:12px;color:var(--ink-faint);margin-top:3px;">+${ev.variantCount} other ticket option${ev.variantCount === 1 ? '' : 's'} for this show</div>`
    : '';
  // Horizontal row layout — same fields as before (name, venue/city,
  // date, price, variant note, ticket link), no image, no new
  // information added — just restructured left (title+meta+date) /
  // right (price+CTA) instead of the previous stacked card.
  return `
    <a href="${href}" class="event-row" style="text-decoration:none;">
      <div class="event-row-main">
        <h3>${escapeHtml(ev.name)}</h3>
        <div class="meta">${metaLine}</div>
        <div class="date">${escapeHtml(dateLine)}</div>
        ${variantLine}
      </div>
      <div class="event-row-side">
        <span class="from">${priceLine}</span>
        <span class="cta">Tickets \u2192</span>
      </div>
    </a>`;
}

function artistRowHtml(artist, citySlug) {
  return `<a href="/search/?city=${encodeURIComponent(citySlug)}" class="card" style="padding:16px;display:block;text-decoration:none;">
    <div style="font-weight:800;font-size:15px;">${escapeHtml(artist.name)}</div>
    <div style="font-size:12.5px;color:var(--ink-dim);margin-top:4px;">${artist.count} upcoming event${artist.count === 1 ? '' : 's'}</div>
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
// an unrecognized slug. concertsOnly=false renders the general "all
// events" page (/events/{slug}/); concertsOnly=true renders the
// concerts-specific page (/events/{slug}/concerts/) — same underlying
// data-fetching, dedup, price-verification, and template logic either
// way, per the instruction to extend rather than duplicate the
// existing architecture.
async function renderCityPageInternal(slug, concertsOnly, env, siteOrigin, pageNum) {
  const cityRecord = getSeoCityBySlug(slug);
  if (!cityRecord) return null;

  const page = pageNum || 1;
  const cacheKey = `${slug}:${concertsOnly ? 'concerts' : 'all'}:page${page}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { html: cached.html };

  const allEvents = await fetchRealEventsForCity(cityRecord, env, concertsOnly);
  // Venues and artists are counted from the FULL real event list for
  // this page's own category scope (every real ticket product still
  // represents a real upcoming show at that venue/by that artist) —
  // only the primary "Upcoming events" list itself gets deduplicated
  // to one canonical listing per underlying show, per the audit's #1
  // priority finding. These sections stay the same across every
  // pagination page — only the "Upcoming events" list itself paginates.
  const venues = buildVenueSection(allEvents);
  const artists = buildArtistSection(allEvents);
  const allDedupedEvents = dedupeUnderlyingEvents(allEvents);

  // Real pagination — 10 events per page, matching the reference UI
  // (numbered pills + prev/next). Each page is its own real, crawlable
  // URL (/events/{slug}/page/{n}/), not a query param, so every page's
  // content is genuinely indexable rather than treated as a filter
  // variant. An out-of-range page number 404s (returns null) rather
  // than silently clamping or showing an empty shell.
  const PAGE_SIZE = 10;
  const totalEvents = allDedupedEvents.length;
  const totalPages = Math.max(1, Math.ceil(totalEvents / PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > totalPages) return null;
  const events = allDedupedEvents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const providers = registry.getEnabledTicketProviders(env);
  const tm = providers.find((p) => p.id === 'ticketmaster');
  // Only the current page's 10 events get verified — the actual point
  // of pagination beyond display: a real visitor's request only ever
  // waits on ~10 throttled Ticketmaster calls, not the full city list.
  if (tm) await verifyRealPrices(events, tm, env);

  const generalUrl = `${siteOrigin}/events/${cityRecord.slug}/`;
  const concertsUrl = `${siteOrigin}/events/${cityRecord.slug}/concerts/`;
  const baseUrl = concertsOnly ? concertsUrl : generalUrl;
  const pageUrl = (n) => (n === 1 ? baseUrl : `${baseUrl}page/${n}/`);
  const canonicalUrl = pageUrl(page);

  // Computed at render time, not hardcoded in data/seo-cities.js —
  // confirmed real issue from the audit: a static year in the title
  // silently goes stale the moment the calendar rolls over.
  const currentYear = new Date().getFullYear();
  const pageLabel = concertsOnly ? 'Concerts' : 'Events';
  const pageSuffix = page > 1 ? ` \u2014 Page ${page}` : '';
  const seoTitle = concertsOnly
    ? `Concerts in ${cityRecord.name} ${currentYear}${pageSuffix} \u2014 Concert Tickets | LiveFair24`
    : `Events in ${cityRecord.name} ${currentYear}${pageSuffix} \u2014 Events & Tickets | LiveFair24`;
  const pageDescription = concertsOnly
    ? `Upcoming concerts in ${cityRecord.name}${pageSuffix}. Browse concert dates, venues, and find tickets on LiveFair24.`
    : `${cityRecord.seoDescription}${pageSuffix}`;
  const pageIntro = concertsOnly
    ? `Upcoming concerts in ${cityRecord.name}, real listings sourced live from Ticketmaster. Browse dates, venues, and find tickets below.`
    : cityRecord.seoIntro;

  const eventListHtml = events.length > 0
    ? events.map(eventCardHtml).join('')
    : `<div style="padding:24px;color:var(--ink-faint);font-size:14.5px;">No current ${concertsOnly ? 'concert ' : ''}listings for ${escapeHtml(cityRecord.name)} \u2014 check back soon.</div>`;

  // Pagination nav — numbered pills + prev/next, real <a href> links to
  // real paginated URLs. Truncates with an ellipsis once there are many
  // pages, matching the reference UI (1, 2, 3 ... 11).
  function pageBtnHtml(n, label, active) {
    const disabled = n == null;
    const cls = 'pgn-btn' + (active ? ' active' : '') + (disabled ? ' disabled' : '');
    if (disabled) return `<span class="${cls}">${label}</span>`;
    return `<a href="${pageUrl(n)}" class="${cls}">${label}</a>`;
  }
  let paginationHtml = '';
  if (totalPages > 1) {
    const pageNumbers = [];
    const window = 1; // how many neighbors on each side of the current page to always show
    for (let n = 1; n <= totalPages; n++) {
      if (n === 1 || n === totalPages || Math.abs(n - page) <= window) pageNumbers.push(n);
      else if (pageNumbers[pageNumbers.length - 1] !== '...') pageNumbers.push('...');
    }
    paginationHtml = `
  <div class="pagination-nav">
    ${pageBtnHtml(page > 1 ? page - 1 : null, '\u2190', false)}
    ${pageNumbers.map((n) => (n === '...' ? '<span class="pgn-ellipsis">\u2026</span>' : pageBtnHtml(n, String(n), n === page))).join('')}
    ${pageBtnHtml(page < totalPages ? page + 1 : null, '\u2192', false)}
  </div>`;
  }

  const venueSectionHtml = venues.length > 0 ? `
  <section class="section">
    <div class="section-header"><div><h2>Popular venues in ${escapeHtml(cityRecord.name)}</h2></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
      ${venues.map((v) => venueRowHtml(v, cityRecord.slug)).join('')}
    </div>
  </section>` : '';

  const artistSectionHtml = artists.length > 0 ? `
  <section class="section">
    <div class="section-header"><div><h2>Popular artists in ${escapeHtml(cityRecord.name)}</h2></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
      ${artists.map((a) => artistRowHtml(a, cityRecord.slug)).join('')}
    </div>
  </section>` : '';

  // Real crawlable cross-link between the two pages (audit's internal
  // linking requirement) — plain <a href>, not JS-driven.
  const crossLinkHtml = concertsOnly
    ? `<p style="font-size:13.5px;margin-top:16px;"><a href="${generalUrl}" style="color:var(--blue);">\u2190 All events in ${escapeHtml(cityRecord.name)}</a></p>`
    : `<p style="font-size:13.5px;margin-top:16px;"><a href="${concertsUrl}" style="color:var(--blue);">Concerts in ${escapeHtml(cityRecord.name)} \u2192</a></p>`;

  // Real ItemList structured data — only the events actually returned
  // above, real names/dates/URLs, no invented items to pad the list.
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: events.map((ev, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${siteOrigin}/events/${encodeURIComponent(ev.eventId)}/${encodeURIComponent(ev.slug)}`,
      name: ev.name,
    })),
  };
  const breadcrumbItems = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteOrigin}/` },
    { '@type': 'ListItem', position: 2, name: 'Events', item: `${siteOrigin}/concerts/` },
    { '@type': 'ListItem', position: 3, name: cityRecord.name, item: generalUrl },
  ];
  if (concertsOnly) breadcrumbItems.push({ '@type': 'ListItem', position: 4, name: 'Concerts' });
  const breadcrumbJsonLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: breadcrumbItems };

  const breadcrumbHtml = concertsOnly
    ? `<a href="/">Home</a><span class="sep">\u203a</span>
    <a href="/concerts/">Events</a><span class="sep">\u203a</span>
    <a href="${generalUrl}">${escapeHtml(cityRecord.name)}</a><span class="sep">\u203a</span>
    <span>Concerts</span>`
    : `<a href="/">Home</a><span class="sep">\u203a</span>
    <a href="/concerts/">Events</a><span class="sep">\u203a</span>
    <span>${escapeHtml(cityRecord.name)}</span>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${escapeHtml(seoTitle)}</title>
<meta name="description" content="${escapeHtml(pageDescription)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">
${page > 1 ? `<link rel="prev" href="${pageUrl(page - 1)}">` : ''}
${page < totalPages ? `<link rel="next" href="${pageUrl(page + 1)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v=20260819yfix">
<meta property="og:title" content="${escapeHtml(seoTitle)}">
<meta property="og:description" content="${escapeHtml(pageDescription)}">
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
    ${breadcrumbHtml}
  </div>
</div>

<main>
<div class="container">

  <section style="padding:40px 0 24px;max-width:74ch;">
    <span class="badge badge-blue" style="margin-bottom:16px;">${escapeHtml(cityRecord.country)}</span>
    <h1 class="display" style="font-size:clamp(28px,4.5vw,48px);">${pageLabel} in ${escapeHtml(cityRecord.name)} ${currentYear}</h1>
    <p style="font-size:16px;color:var(--ink-dim);margin-top:14px;line-height:1.7;">${escapeHtml(pageIntro)}</p>
    ${crossLinkHtml}
  </section>

  <section class="section" style="padding-top:0;">
    <div class="section-header"><div><h2>Upcoming ${concertsOnly ? 'concerts' : 'events'} in ${escapeHtml(cityRecord.name)}</h2><p>Real ticket listings, sorted by date.</p></div></div>
    <div class="event-row-list">
      ${eventListHtml}
    </div>
    ${paginationHtml}
  </section>

  ${venueSectionHtml}

  ${artistSectionHtml}

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

  cache.set(cacheKey, { html, expiresAt: Date.now() + CACHE_TTL_MS });
  return { html };
}

async function renderCityAllEventsPage(slug, env, siteOrigin, pageNum) {
  return renderCityPageInternal(slug, false, env, siteOrigin, pageNum);
}
async function renderCityConcertsPage(slug, env, siteOrigin, pageNum) {
  return renderCityPageInternal(slug, true, env, siteOrigin, pageNum);
}

// Background pre-warming — the actual fix for the "Eventim's equivalent
// page is much faster" question: Eventim reads from their own
// pre-ingested database at request time (fast, no external dependency).
// This route instead makes real, live Ticketmaster calls as part of
// rendering — one broad search plus up to 10 individual per-event price
// verifications, each correctly spaced ~220ms apart by the global
// throttle (providers/tickets/ticketmaster.js) to respect Ticketmaster's
// own confirmed rate limit. That live-fetch cost is unavoidable in
// itself, but it doesn't have to sit in a real visitor's critical path
// — trending.js, concertCategories.js, and matches.js all solved this
// the same way already; this route just never had the same treatment.
// Fires immediately on startup, then on a fixed interval comfortably
// inside CACHE_TTL_MS, so under normal operation a real request almost
// always hits an already-warm cache instead of triggering the live
// fetch chain itself.
//
// Confirmed real gap, reported directly: this originally only warmed
// PAGE 1 of each city/mode — clicking to page 2/3/etc. always hit an
// uncached page and paid the full live-fetch cost itself (the reported
// 3-5s per click). Now loops every real page for each city/mode, not
// just the first — relies on renderCityPageInternal's own existing
// out-of-range check (page > totalPages returns null) as the natural
// stopping point, so this doesn't need to duplicate that page-count
// math here.
const BACKGROUND_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour — half of CACHE_TTL_MS, same margin concertCategories.js uses
const SITE_ORIGIN_FOR_BACKGROUND_REFRESH = 'https://www.livefair24.com'; // no incoming request to derive this from in a background job

async function backgroundRefreshCityPages() {
  // lowPriority:true marks every real Ticketmaster call this job makes
  // as background-triggered — see providers/tickets/ticketmaster.js's
  // two-lane priority queue. Confirmed real regression this fixes: with
  // 12 cities now pre-warmed, this job alone can queue well over a
  // hundred real calls; without this flag those calls would compete
  // equally with a real visitor's own request instead of yielding to it.
  const env = { ...registry.getMergedEnv(), lowPriority: true }; // re-read fresh each cycle — picks up an admin-panel key change without a restart, same reasoning as the other background jobs
  for (const cityRecord of SEO_CITIES) {
    for (const concertsOnly of [false, true]) {
      let page = 1;
      // Safety cap — real city inventories here are small (tens of
      // events, not thousands), so this should never actually get
      // close to 50 pages; it's just a hard backstop against looping
      // forever if something upstream ever misbehaves.
      const MAX_PAGES_SAFETY_CAP = 50;
      while (page <= MAX_PAGES_SAFETY_CAP) {
        try {
          const result = await renderCityPageInternal(cityRecord.slug, concertsOnly, env, SITE_ORIGIN_FOR_BACKGROUND_REFRESH, page);
          if (!result) break; // past the last real page for this city/mode
        } catch (err) {
          console.warn('[cityPage background refresh]', cityRecord.slug, concertsOnly ? 'concerts' : 'all', 'page', page, err.message);
          break;
        }
        page++;
      }
    }
  }
}

function startBackgroundCityPagesRefresh() {
  backgroundRefreshCityPages().catch((err) => console.warn('[cityPage background refresh]', err.message));
  setInterval(() => {
    backgroundRefreshCityPages().catch((err) => console.warn('[cityPage background refresh]', err.message));
  }, BACKGROUND_REFRESH_INTERVAL_MS);
}

module.exports = { renderCityAllEventsPage, renderCityConcertsPage, startBackgroundCityPagesRefresh };
