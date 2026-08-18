// routes/venuePage.js
//
// GET /venues/{slug}/ — the venue-side counterpart to routes/artistPage.js.
// Same rule: only renders if a real, live Ticketmaster search turns up
// events that actually take place at this venue. Unlike the artist page
// (which groups by Ticketmaster's own attractionId), this filters by
// matching the venue name in each result, since Ticketmaster's keyword
// search doesn't have a dedicated "search by venue" mode — a keyword
// search for a venue name can return unrelated results (e.g. an artist
// who happens to share part of the name), so results are only kept when
// the event's own venue field genuinely matches what was searched for.

const registry = require('./../providers/registry');
const cityImage = require('./../providers/geo/cityImage');
const { buildCanonicalSlug } = require('./eventPage');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function formatDate(dateStr, timeStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  const dayLabel = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return timeStr ? `${dayLabel} · ${timeStr.slice(0, 5)}` : dayLabel;
}

function slugify(str) {
  // Same NFD-decompose fix as artistPage.js — see that file's comment
  // for why the naive version silently mangled German umlauts.
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalize(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function deslugify(slug) {
  return slug.replace(/-/g, ' ').trim();
}

async function fetchVenueEvents(searchName, env) {
  const tm = registry.ticketProviders.find((p) => p.id === 'ticketmaster');
  if (!tm || !tm.isEnabled(env) || typeof tm.searchEvents !== 'function') return [];
  const results = await tm.searchEvents({ query: searchName, limit: 50 }, env);
  if (!Array.isArray(results) || results.length === 0) return [];

  const normalizedSearch = normalize(searchName);
  // Only keep results whose OWN venue field genuinely matches what was
  // searched for — a keyword search can return events unrelated to this
  // venue (e.g. an artist whose name happens to overlap), so this is the
  // real filter, not just deduping.
  const matching = results.filter((ev) => {
    const normalizedVenue = normalize(ev.venue);
    return normalizedVenue && (normalizedVenue.includes(normalizedSearch) || normalizedSearch.includes(normalizedVenue));
  });

  const seen = new Set();
  const deduped = matching.filter((ev) => {
    if (!ev.eventId || seen.has(ev.eventId)) return false;
    seen.add(ev.eventId);
    return true;
  });
  deduped.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return deduped;
}

async function renderVenuePage(slug, env, siteOrigin) {
  const searchName = deslugify(slug);
  const events = await fetchVenueEvents(searchName, env);
  if (events.length === 0) return null;

  const realVenueName = events[0].venue;
  const city = events[0].city;
  const state = events[0].state;
  const country = events[0].country;
  const canonicalSlug = slugify(realVenueName);
  const canonicalUrl = `${siteOrigin}/venues/${canonicalSlug}/`;
  // Real photo of this venue's own host city — Ticketmaster's venue
  // objects carry no image of their own (see
  // providers/geo/cityImage.js's header comment), so this is the
  // Suggested carousel's approved stand-in, carried into the
  // "Recently viewed" localStorage entry below the same way
  // artistPage.js carries a real event photo for artists. state
  // disambiguates cities that share a name with other real places
  // (e.g. "Lafayette" matches cities in Louisiana, Indiana,
  // California, and Colorado, plus the Marquis de Lafayette) — see
  // cityImage.js for the confirmed case that motivated this.
  const venueImageUrl = await cityImage.getCityImageUrl(city, state);

  const eventRows = events
    .map((ev) => {
      const evSlug = buildCanonicalSlug({ artist: ev.name, city: ev.city, isoDate: ev.date });
      const href = `/events/${encodeURIComponent(ev.eventId)}/${evSlug}`;
      const dateLabel = formatDate(ev.date, ev.time);
      return `<a href="${href}" class="artist-event-row"><div><div class="artist-event-date">${escapeHtml(dateLabel)}</div><div class="artist-event-venue">${escapeHtml(ev.name)}</div></div><span class="artist-event-arrow">View event →</span></a>`;
    })
    .join('\n');

  const title = `${realVenueName} — Upcoming Events${city ? ' in ' + city : ''} | LiveFair24`;
  const description = `${events.length} upcoming event${events.length === 1 ? '' : 's'} at ${realVenueName}${city ? ', ' + city : ''} — real dates and ticket prices on LiveFair24.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonicalUrl}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteOrigin}/` },
    { '@type': 'ListItem', position: 2, name: 'Venues', item: `${siteOrigin}/venues/` },
    { '@type': 'ListItem', position: 3, name: realVenueName },
  ],
})}</script>
<style>
.artist-event-row{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;background:var(--surface);transition:border-color .15s;}
.artist-event-row:hover{border-color:var(--blue);}
.artist-event-date{font-family:'Sora',sans-serif;font-weight:700;font-size:15px;color:var(--ink);}
.artist-event-venue{font-size:13.5px;color:var(--ink-dim);margin-top:2px;}
.artist-event-arrow{color:var(--blue);font-weight:700;font-size:13.5px;white-space:nowrap;margin-left:16px;}
</style>
</head>
<body>
<nav class="site-nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo"><span class="dot"></span>LiveFair24</a>
    <div class="nav-links">
      <a href="/cities/">Browse cities</a>
      <a href="/artists/">Artists</a>
      <a href="/venues/">Venues</a>
      <a href="/guides/how-it-works.html">How it works</a>
      <a href="/sports/index.html">Sports</a>
    </div>
    <div class="nav-right">
      <a href="/search/" class="nav-cta">Search concerts</a>
    </div>
  </div>
</nav>
<div class="container" style="padding-top:40px;padding-bottom:60px;">
  <div style="font-size:13px;color:var(--ink-faint);margin-bottom:16px;">
    <a href="/" style="color:var(--ink-faint);">Home</a> ›
    <a href="/venues/" style="color:var(--ink-faint);">Venues</a> ›
    <strong style="color:var(--ink);">${escapeHtml(realVenueName)}</strong>
  </div>
  <h1 class="display" style="font-size:clamp(28px,5vw,42px);margin-bottom:8px;">${escapeHtml(realVenueName)}</h1>
  <p style="color:var(--ink-dim);margin-bottom:32px;">${[city, country].filter(Boolean).map(escapeHtml).join(', ')}${city ? ' · ' : ''}${events.length} upcoming event${events.length === 1 ? '' : 's'}</p>
  <div>
    ${eventRows}
  </div>
</div>
<script>
// Same "Recent" tracking as routes/artistPage.js — see that file's
// comment for the reasoning.
(function(){
  try {
    var KEY = 'lf24_recently_viewed';
    var entry = { type: 'venue', slug: ${JSON.stringify(canonicalSlug)}, name: ${JSON.stringify(realVenueName)}, imageUrl: ${JSON.stringify(venueImageUrl)}, viewedAt: Date.now() };
    var existing = JSON.parse(localStorage.getItem(KEY) || '[]');
    existing = existing.filter(function(e){ return !(e.type === entry.type && e.slug === entry.slug); });
    existing.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(existing.slice(0, 12)));
  } catch(e) { /* localStorage unavailable (private browsing etc.) — not worth failing the page over */ }
})();
</script>
</body>
</html>`;

  return { html, canonicalSlug };
}

module.exports = { renderVenuePage };
