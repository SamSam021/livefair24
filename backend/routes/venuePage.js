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
const venueContentStore = require('./../venue-content-store');
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

// Renders admin-authored free text as real paragraph blocks with real
// clickable links — added specifically after a reference comparison
// (TickPick's own venue FAQ content) showed two concrete gaps: their
// body text reads as distinct paragraph blocks with real spacing
// between them, and a plain URL like "https://en.wikipedia.org/..."
// pasted into a reference line renders as a real clickable link, not
// inert plain text. Escapes first, then linkifies the ALREADY-escaped
// text — safe because escaped text never contains a raw < or >, so the
// URL-matching regex can't accidentally straddle an HTML entity.
// Splits on blank lines for paragraph blocks (matching how the admin
// panel's own textarea naturally separates paragraphs when typed), and
// converts single line breaks within one paragraph to <br> (address/
// transport lines are often meant to stay on separate lines within the
// same paragraph, e.g. "Uber-Platz 1" / "10243 Berlin").
function renderAdminText(text) {
  const paragraphs = (text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paragraphs
    .map((p) => {
      const escaped = escapeHtml(p).replace(/\n/g, '<br>');
      const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" target="_blank" rel="noopener" style="color:var(--blue);">${url}</a>`);
      return `<p style="margin-bottom:14px;">${linked}</p>`;
    })
    .join('');
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

  // Confirmed real SEO issue, reported directly: this page previously
  // 404'd outright whenever a venue had zero current live events —
  // exactly the "delete the URL because inventory is temporarily
  // empty" mistake the spec explicitly warned against for EVENT pages
  // (section 26: never 404 just because something's between bookings —
  // Google's accumulated rankings/backlinks/trust on that URL can be
  // lost and have to be rebuilt from scratch once it reappears). Venue
  // identity (name/city/country/venueId) previously came ONLY from the
  // live events themselves, so a genuine gap meant literally no way to
  // know the venue existed. Saved admin content already stores that
  // same identity independently — falling back to it here means a
  // venue you've written content for never disappears, gap or no gap.
  // A venue with neither live events NOR saved content genuinely has
  // nothing to render (no identity, no content) and still 404s — that
  // page was never meaningfully reachable in the first place, so
  // there's no accumulated SEO value at risk either way.
  let realVenueName, city, state, country, venueId;
  if (events.length > 0) {
    realVenueName = events[0].venue;
    city = events[0].city;
    state = events[0].state;
    country = events[0].country;
    venueId = events[0].venueId;
  } else {
    const allSaved = venueContentStore.getAllVenueContent();
    const matchedId = Object.keys(allSaved).find((id) => slugify(allSaved[id].venueName || '') === slug);
    if (!matchedId) return null; // genuinely nothing to render — no live events, no saved identity
    const saved = allSaved[matchedId];
    realVenueName = saved.venueName;
    city = saved.city;
    state = null;
    country = saved.country;
    venueId = matchedId;
  }

  const canonicalSlug = slugify(realVenueName);
  const canonicalUrl = `${siteOrigin}/venues/${canonicalSlug}/`;

  // Optional admin-authored content — see venue-content-store.js's own
  // header comment. Keyed by Ticketmaster's real venue ID (events[0]
  // already carries this on every result, since they all share the
  // same venue by construction of fetchVenueEvents above). Purely
  // additive: if nothing was ever saved for this venue, adminSections
  // stays empty and the page renders exactly as it always has.
  const adminContent = venueId ? venueContentStore.getVenueContent(venueId) : null;
  const SECTION_LABELS = {
    about: 'About the venue',
    howToGetThere: 'How to get there',
    address: 'Address',
    publicTransport: 'Public transport',
    parking: 'Parking',
    seating: 'Seating information',
  };
  const adminSectionsHtml = adminContent
    ? Object.keys(SECTION_LABELS)
        .filter((key) => adminContent.sections[key] && adminContent.sections[key].enabled)
        .map((key) => `
    <div style="margin-bottom:28px;">
      <h2 style="font-size:19px;margin-bottom:10px;">${escapeHtml(SECTION_LABELS[key])}</h2>
      <div style="color:var(--ink-dim);font-size:15.5px;line-height:1.75;">${renderAdminText(adminContent.sections[key].text)}</div>
    </div>`)
        .join('')
    : '';

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

  const eventRows = events.length > 0
    ? events
        .map((ev) => {
          const evSlug = buildCanonicalSlug({ artist: ev.name, city: ev.city, isoDate: ev.date });
          const href = `/events/${encodeURIComponent(ev.eventId)}/${evSlug}`;
          const dateLabel = formatDate(ev.date, ev.time);
          return `<a href="${href}" class="artist-event-row"><div><div class="artist-event-date">${escapeHtml(dateLabel)}</div><div class="artist-event-venue">${escapeHtml(ev.name)}</div></div><span class="artist-event-arrow">View event →</span></a>`;
        })
        .join('\n')
    : `<p style="color:var(--ink-faint);padding:20px 0;">No upcoming events at ${escapeHtml(realVenueName)} right now — check back soon.</p>`;

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
  ${adminSectionsHtml}
  ${adminSectionsHtml ? '<h2 style="font-size:19px;margin-bottom:16px;">Upcoming events</h2>' : ''}
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

module.exports = { renderVenuePage, slugify };
