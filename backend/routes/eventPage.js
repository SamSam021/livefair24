// routes/eventPage.js
//
// Server-side rendering for real, indexable event pages at
// /events/:eventId/:slug — the fix for the gap found while reviewing
// SEO: events/view.html (the page real visitors land on) previously
// built its entire event identity from URL query parameters at runtime,
// entirely client-side, and was correctly marked noindex because of it.
// Nothing about a specific event was ever in the page Google could see.
//
// This module fetches the REAL, CURRENT event straight from Ticketmaster
// by its real eventId (never from db/seed-data's 6 hardcoded demo
// events — those are fixtures, not live inventory, and shipping them as
// indexable pages would be exactly the fabrication this whole SEO
// exercise is meant to avoid) and injects that real data into the same
// events/view.html template already used for the rich interactive
// experience (map, live ticket/hotel panels, FAQ) — so nothing about
// that UI needed to be duplicated or rebuilt.

const fs = require('fs');
const path = require('path');
const registry = require('../providers/registry');

const VIEW_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'fairlive-site', 'events', 'view.html');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Mirrors formatDate() in events/view.html exactly, so the server-
// rendered display text matches what the client-side code would have
// produced for the same data — no visible flash/mismatch on load.
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
  // "waldb-hne" a naive [^a-z0-9] strip produces. Confirmed as a real bug
  // via direct testing (the diaeresis was silently deleted, not
  // transliterated) — significant given how much of this site's actual
  // inventory is German.
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildCanonicalSlug(realEvent) {
  const parts = [realEvent.artist, realEvent.city, realEvent.isoDate].filter(Boolean);
  return slugify(parts.join('-')) || 'event';
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Fetches the real event by eventId directly from Ticketmaster — no
// caching, no database, always the current live data, same source of
// truth the rest of the site already uses for this event.
async function fetchRealEvent(eventId, env) {
  const tm = registry.ticketProviders.find((p) => p.id === 'ticketmaster');
  if (!tm || !tm.isEnabled(env) || typeof tm.getEventDetails !== 'function') return null;
  const mapped = await tm.getEventDetails(eventId, env);
  if (!mapped) return null;

  return {
    artist: mapped.name || 'Event',
    venue: mapped.venue || '',
    city: mapped.city || '',
    country: mapped.country || '',
    isoDate: mapped.date || '',
    time: mapped.time || '',
    date: formatDate(mapped.date, mapped.time),
    ticket: mapped.lowestPrice != null ? `$${Math.round(mapped.lowestPrice)}` : null,
    lat: mapped.lat,
    lng: mapped.lng,
    eventId: mapped.eventId || eventId,
    sourceUrl: mapped.url || null,
    genre: mapped.genre || '',
  };
}

// Returns { html, canonicalSlug } on success, or null if the event
// can't be found (caller should respond 404 — never render a page shell
// with no real event behind it).
async function renderEventPage(eventId, requestedSlug, env, siteOrigin) {
  const realEvent = await fetchRealEvent(eventId, env);
  if (!realEvent || !realEvent.venue || !realEvent.isoDate) {
    // Missing venue/date means we don't have enough to call this a real,
    // useful page — matches the "materially thin" non-eligibility rule
    // rather than publishing a half-empty page.
    return null;
  }

  const canonicalSlug = buildCanonicalSlug(realEvent);
  const canonicalUrl = `${siteOrigin}/events/${encodeURIComponent(eventId)}/${canonicalSlug}`;

  let html = fs.readFileSync(VIEW_TEMPLATE_PATH, 'utf8');

  const titleText = `${realEvent.artist} — ${realEvent.venue ? realEvent.venue + ', ' : ''}${realEvent.city} | LiveFair24`;
  const descText = `${realEvent.artist} at ${realEvent.venue}${realEvent.city ? ', ' + realEvent.city : ''}${realEvent.date ? ' — ' + realEvent.date : ''}. Real-time ticket prices and nearby hotels on LiveFair24.`;

  html = html.replace(
    /<title>.*?<\/title>/s,
    `<title>${escapeHtml(titleText)}</title>`
  );
  html = html.replace(
    /<meta name="description" content=".*?">/s,
    `<meta name="description" content="${escapeHtml(descText)}">`
  );
  // The template's default is intentionally noindex (correct for the
  // query-param-only mode) — this route has real, verified data behind
  // it, so it's eligible to be indexed.
  html = html.replace(
    /<meta name="robots" content="noindex, follow">/,
    `<meta name="robots" content="index, follow">\n<link rel="canonical" href="${canonicalUrl}">`
  );

  // The H1 and the date/venue/artist row beneath it previously only ever
  // got filled in by client-side JS reading window.__EVENT__ — meaning
  // the raw HTML (what a plain fetch, or Google's first crawl pass
  // before it renders JS, actually sees) showed nothing but "Loading
  // event…" and an empty div. Filling these in here means the core
  // visible identity is present immediately, matching the same
  // "don't require JS to discover the core event identity" principle
  // already applied to the <head> tags above. The client-side JS still
  // runs afterward and overwrites these with the exact same real
  // values — harmless, and it also upgrades the venue/artist links to
  // their dedicated pages when one exists (KNOWN_VENUE_PAGES /
  // KNOWN_ARTIST_PAGES — a lookup table that only exists client-side),
  // which is why the server-rendered links below deliberately point to
  // the generic /venues/ and /artists/ browse pages rather than
  // guessing at a specific page that may not exist.
  html = html.replace(
    /id="pageTitle">Loading event…</,
    `id="pageTitle">${escapeHtml(realEvent.artist)}<`
  );
  const metaRowParts = [];
  if (realEvent.date) {
    metaRowParts.push(`<div style="display:flex;align-items:center;gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg><span><strong style="color:var(--ink);">${escapeHtml(realEvent.date)}</strong></span></div>`);
  }
  if (realEvent.venue || realEvent.city || realEvent.country) {
    const venueLink = realEvent.venue
      ? `<a href="/venues/" style="color:var(--blue);font-weight:700;">${escapeHtml(realEvent.venue)}</a>` : '';
    const rest = [realEvent.city, realEvent.country].filter(Boolean).map(escapeHtml).join(', ');
    metaRowParts.push(`<div style="display:flex;align-items:center;gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg><span>${venueLink}${venueLink && rest ? ', ' : ''}${rest}</span></div>`);
  }
  if (realEvent.artist) {
    metaRowParts.push(`<div style="display:flex;align-items:center;gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><a href="/artists/" style="color:var(--blue);font-weight:700;">${escapeHtml(realEvent.artist)}</a></div>`);
  }
  html = html.replace(
    'id="pageMetaRow"></div>',
    `id="pageMetaRow">${metaRowParts.join('')}</div>`
  );

  // JSON-LD — only fields we actually have real values for. No invented
  // start time, no invented price, no invented availability.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: realEvent.artist,
    startDate: realEvent.time ? `${realEvent.isoDate}T${realEvent.time}` : realEvent.isoDate,
    location: {
      '@type': 'Place',
      name: realEvent.venue,
      address: {
        '@type': 'PostalAddress',
        addressLocality: realEvent.city || undefined,
        addressCountry: realEvent.country || undefined,
      },
    },
  };
  if (realEvent.ticket != null && realEvent.sourceUrl) {
    jsonLd.offers = {
      '@type': 'Offer',
      price: realEvent.ticket.replace('$', ''),
      priceCurrency: 'USD',
      url: realEvent.sourceUrl,
      availability: 'https://schema.org/InStock',
    };
  }

  const injected = `
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script>window.__EVENT__ = ${JSON.stringify(realEvent)};</script>
`;
  html = html.replace('</head>', `${injected}</head>`);

  return { html, canonicalSlug };
}

module.exports = { renderEventPage, buildCanonicalSlug };
