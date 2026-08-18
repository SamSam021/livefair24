// routes/eventsSitemap.js
//
// GET /sitemap-events.xml — the dynamic counterpart to the hand-maintained
// /sitemap.xml. Individual events are fundamentally unlike the rest of the
// site's pages: new ones appear via Ticketmaster constantly and old ones
// sell out or pass, so hardcoding a handful into a static file would go
// stale almost immediately. This queries the same real, live pipeline
// that already powers the homepage's trending cards (routes/trending.js)
// across a few major markets, and only includes events that pass the
// exact same "materially thin" bar as the page renderer itself
// (routes/eventPage.js) — a real venue and a real date. No event is
// listed here that wouldn't also successfully render if visited.

const trendingRoutes = require('./trending');
const { buildCanonicalSlug } = require('./eventPage');

// Matches the initial-launch market priority discussed for this project
// (USA, Germany, UK) — not an attempt at global coverage yet.
const SITEMAP_MARKETS = ['US', 'DE', 'GB'];

function escapeXml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

async function generateEventsSitemapXml(env) {
  const seen = new Map(); // eventId -> event, deduped across markets

  await Promise.all(
    SITEMAP_MARKETS.map(async (country) => {
      try {
        const { results } = await trendingRoutes.getTrendingEvents(null, env, country);
        for (const ev of results || []) {
          // Same eligibility bar as eventPage.js's own publish check —
          // an event listed here must be one that would actually render
          // successfully if visited, not just one that showed up in a
          // search.
          if (ev.eventId && ev.venue && ev.date && !seen.has(ev.eventId)) {
            seen.set(ev.eventId, ev);
          }
        }
      } catch (err) {
        console.warn(`[events sitemap] market ${country} failed:`, err.message);
        // One market failing shouldn't take down the whole sitemap —
        // still generate it from whichever markets succeeded.
      }
    })
  );

  const today = new Date().toISOString().slice(0, 10);
  const urlEntries = [...seen.values()]
    .map((ev) => {
      const slug = buildCanonicalSlug({ artist: ev.name, city: ev.city, isoDate: ev.date });
      const loc = `https://livefair24.com/events/${encodeURIComponent(ev.eventId)}/${slug}`;
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.90</priority>\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<!-- Generated live from real, currently-searchable events across ${SITEMAP_MARKETS.join(', ')} —
     never hand-edited. Regenerated fresh on every request; an event that
     sells out or passes simply stops appearing here on its own, same way
     it stops appearing in search results. -->
${urlEntries}
</urlset>`;
}

module.exports = { generateEventsSitemapXml };
