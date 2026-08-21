// routes/artistPage.js
//
// GET /artists/{attractionId}/{slug} — the middle layer between the
// homepage and individual event pages, matching the pattern TickPick
// actually uses in production (confirmed by reading their live site):
// Category -> real performer hub page (with a genuine, current event
// count) -> individual event. LiveFair24 had the top and bottom layers
// before this; this is the missing middle one.
//
// Resolved by Ticketmaster's own attractionId — same convention as
// /events/{eventId}/{slug} in eventPage.js — rather than a keyword
// re-search of the URL slug. That used to be how this worked, and it
// had a confirmed real failure mode: "2. Hamburg Festival 2026" was a
// genuine, currently-listed, correctly-suggested event, but a fresh
// keyword search of its deslugified name ("2 hamburg festival 2026")
// didn't reliably re-match its own literal title (leading digit,
// punctuation, generic wording), so the page 404'd despite the event
// being real. attractionId sidesteps that whole class of failure —
// Ticketmaster already knows exactly which events belong to this
// attraction, no text matching involved. Same discipline as
// routes/eventPage.js either way: this only renders if the lookup
// actually turns up real, current events — matching Section 29's own
// rule ("only publish this page if the entity otherwise provides
// meaningful value"). No event count is ever fabricated; it's always
// exactly how many real results came back.

const fs = require('fs');
const path = require('path');
const registry = require('./../providers/registry');
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
  // NFD-decompose first ("ü" -> "u" + combining diaeresis) then strip the
  // combining marks — turns "Waldbühne" into "waldbuhne", not the broken
  // "waldb-hne" a naive [^a-z0-9] strip produces (confirmed as a real bug
  // via direct testing — the diaeresis was silently deleted rather than
  // transliterated, which matters a lot given how much of this site's
  // real inventory is German).
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const { createCache } = require('./../lib/simpleCache');
const artistEventsCache = createCache();
const SUCCESS_TTL_MS = 5 * 60 * 1000; // 5 minutes, matching every other endpoint's window
const FAILURE_TTL_MS = 60 * 1000;

async function fetchArtistEventsById(attractionId, env) {
  // Confirmed real problem this fixes: no caching at all (every page
  // view re-fetched fresh), and no try/catch around the Ticketmaster
  // call — a 429 here would previously surface as an uncaught error
  // (a 500 from server.js's route handler) instead of the graceful
  // "no upcoming events" 404 this page is supposed to show when
  // Ticketmaster genuinely has nothing. Caching needed a failure path
  // anyway, which fixes both at once.
  const cached = artistEventsCache.get(attractionId);
  if (cached) return cached;

  const tm = registry.ticketProviders.find((p) => p.id === 'ticketmaster');
  if (!tm || !tm.isEnabled(env) || typeof tm.searchEvents !== 'function') return [];

  let results;
  try {
    // allCategories: true — this is a direct ID lookup for one specific,
    // already-validated attraction (routes/suggested.js only ever
    // suggests attractions with a confirmed Sports or Music genre), so
    // the classificationName=music restriction the provider applies to
    // broad keyword/browse searches would wrongly zero out a real Sports
    // attraction's events here. See ticketmaster.js's searchEvents.
    results = await tm.searchEvents({ attractionId, limit: 50, allCategories: true }, env);
  } catch (err) {
    console.warn('[artist page]', err.message);
    artistEventsCache.set(attractionId, [], FAILURE_TTL_MS);
    return [];
  }
  if (!Array.isArray(results) || results.length === 0) {
    artistEventsCache.set(attractionId, [], FAILURE_TTL_MS);
    return [];
  }

  // Dedupe by eventId (pagination can occasionally return the same show
  // twice) and sort soonest-first. No attractionKey grouping/largest-
  // group step needed here the way the old keyword-based lookup
  // required — attractionId already guarantees every result genuinely
  // belongs to this one attraction, no unrelated near-matches possible.
  const seen = new Set();
  const deduped = results.filter((ev) => {
    if (!ev.eventId || seen.has(ev.eventId)) return false;
    seen.add(ev.eventId);
    return true;
  });
  deduped.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  artistEventsCache.set(attractionId, deduped, SUCCESS_TTL_MS);
  return deduped;
}

async function renderArtistPage(attractionId, requestedSlug, env, siteOrigin) {
  const events = await fetchArtistEventsById(attractionId, env);
  // No real, current events for this attraction at all -> not eligible
  // as a page, same reasoning as eventPage.js's "materially thin"
  // rejection. Better to 404 than publish an empty shell.
  if (events.length === 0) return null;

  const realArtistName = events[0].name;
  const canonicalSlug = slugify(realArtistName);
  const canonicalUrl = `${siteOrigin}/artists/${encodeURIComponent(attractionId)}/${canonicalSlug}/`;
  // First real event image for this act, if any — carried into the
  // "Recently viewed" localStorage entry below so homepage Suggested
  // cards for recent artists can show the same real photo that
  // /api/suggested's "Near you" cards already do, instead of always
  // falling back to the generic icon.
  const artistImageUrl = (events.find((ev) => ev.imageUrl) || {}).imageUrl || null;

  const eventRows = events
    .map((ev) => {
      const evSlug = buildCanonicalSlug({ artist: ev.name, city: ev.city, isoDate: ev.date });
      const href = `/events/${encodeURIComponent(ev.eventId)}/${evSlug}`;
      const dateLabel = formatDate(ev.date, ev.time);
      const venueLabel = [ev.venue, ev.city, ev.country].filter(Boolean).map(escapeHtml).join(', ');
      return `<a href="${href}" class="artist-event-row"><div><div class="artist-event-date">${escapeHtml(dateLabel)}</div><div class="artist-event-venue">${venueLabel}</div></div><span class="artist-event-arrow">View event →</span></a>`;
    })
    .join('\n');

  const title = `${realArtistName} Tickets — Upcoming Events | LiveFair24`;
  const description = `${events.length} upcoming ${realArtistName} event${events.length === 1 ? '' : 's'} — real dates, venues, and ticket prices on LiveFair24.`;

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
    { '@type': 'ListItem', position: 2, name: 'Artists', item: `${siteOrigin}/artists/` },
    { '@type': 'ListItem', position: 3, name: realArtistName },
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
    <a href="/artists/" style="color:var(--ink-faint);">Artists</a> ›
    <strong style="color:var(--ink);">${escapeHtml(realArtistName)}</strong>
  </div>
  <h1 class="display" style="font-size:clamp(28px,5vw,42px);margin-bottom:8px;">${escapeHtml(realArtistName)}</h1>
  <p style="color:var(--ink-dim);margin-bottom:32px;">${events.length} upcoming event${events.length === 1 ? '' : 's'}</p>
  <div>
    ${eventRows}
  </div>
</div>
<script>
// Records this real artist page view for the homepage's "Suggested"
// carousel — the "Recent" half of the same two-source pattern TickPick
// uses (their own homepage shows cards tagged either "Recent" or "Local
// Team"). Capped at 12, most recent first, deduped by id so revisiting
// the same artist just moves it back to the front rather than creating
// a duplicate entry. id (Ticketmaster's attractionId) is what makes the
// Suggested carousel's link back to this page resolve reliably — see
// this file's header comment for why a slug-only link isn't enough.
(function(){
  try {
    var KEY = 'lf24_recently_viewed';
    var entry = { type: 'artist', id: ${JSON.stringify(attractionId)}, slug: ${JSON.stringify(canonicalSlug)}, name: ${JSON.stringify(realArtistName)}, imageUrl: ${JSON.stringify(artistImageUrl)}, viewedAt: Date.now() };
    var existing = JSON.parse(localStorage.getItem(KEY) || '[]');
    existing = existing.filter(function(e){ return !(e.type === entry.type && e.id === entry.id); });
    existing.unshift(entry);
    localStorage.setItem(KEY, JSON.stringify(existing.slice(0, 12)));
  } catch(e) { /* localStorage unavailable (private browsing etc.) — not worth failing the page over */ }
})();
</script>
</body>
</html>`;

  return { html, canonicalSlug };
}

module.exports = { renderArtistPage, slugify };
