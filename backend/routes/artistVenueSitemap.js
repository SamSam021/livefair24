// routes/artistVenueSitemap.js
//
// GET /sitemap-artists.xml and GET /sitemap-venues.xml — same pattern and
// the same "materially thin" eligibility bar as routes/eventsSitemap.js
// (an artist/venue is only listed here if a real, currently-searchable
// Ticketmaster event backs it — never a page generated without a real
// event to justify it existing).
//
// Fills a real, confirmed crawl-discovery gap: artist pages
// (/artists/{attractionId}/{slug}/) were previously reachable only via
// the homepage's rotating Suggested carousel, or an event page's link to
// the generic /artists/ hub rather than the specific artist — meaning a
// smaller act with no current Suggested-carousel visibility had no crawl
// path to its own page at all. Same story for venues.
//
// Derived from the exact same live event data eventsSitemap.js already
// fetches (trending.js's getTrendingEvents, which trending.js's own
// cache already dedupes across near-simultaneous requests) rather than a
// second independent round of API calls — adding these two sitemaps
// doesn't multiply Ticketmaster API usage.

const trendingRoutes = require('./trending');
const artistPageRoutes = require('./artistPage');
const venuePageRoutes = require('./venuePage');

// Same market priority as eventsSitemap.js — not an attempt at global
// coverage yet, matches the initial-launch markets discussed for this
// project (USA, Germany, UK).
const SITEMAP_MARKETS = ['US', 'DE', 'GB'];

function escapeXml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

async function collectEventsAcrossMarkets(env) {
  const allEvents = [];
  await Promise.all(
    SITEMAP_MARKETS.map(async (country) => {
      try {
        const { results } = await trendingRoutes.getTrendingEvents(null, env, country);
        allEvents.push(...(results || []));
      } catch (err) {
        console.warn(`[artist/venue sitemap] market ${country} failed:`, err.message);
        // One market failing shouldn't take down the whole sitemap —
        // still generate it from whichever markets succeeded, same
        // resilience as eventsSitemap.js.
      }
    })
  );
  return allEvents;
}

function buildUrlsetXml(urlEntries, marketsLabel) {
  const today = new Date().toISOString().slice(0, 10);
  const body = urlEntries
    .map(
      (loc) =>
        `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.80</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<!-- Generated live from real, currently-searchable events across ${marketsLabel} —
     never hand-edited. Regenerated fresh on every request. -->
${body}
</urlset>`;
}

async function generateArtistsSitemapXml(env) {
  const events = await collectEventsAcrossMarkets(env);
  const seen = new Map(); // attractionId -> { id, slug }

  for (const ev of events) {
    // attractionId required, not just a name — matches the exact same
    // eligibility rule routes/suggested.js applies before ever
    // suggesting an act (see that file's comment: a confirmed real case,
    // "Grandstand Session 13-Day: Cincinnati Open", was a one-off ticket
    // product with no shared attractionId, and 404'd when treated as an
    // artist). Since /artists/ pages resolve by attractionId
    // (routes/artistPage.js), listing one here without a real ID would
    // produce a sitemap entry that can't actually resolve.
    if (!ev.attractionId || !ev.name || seen.has(ev.attractionId)) continue;
    seen.set(ev.attractionId, { id: ev.attractionId, slug: artistPageRoutes.slugify(ev.name) });
  }

  const urls = [...seen.values()].map((a) => `https://livefair24.com/artists/${encodeURIComponent(a.id)}/${a.slug}/`);
  return buildUrlsetXml(urls, SITEMAP_MARKETS.join(', '));
}

async function generateVenuesSitemapXml(env) {
  const events = await collectEventsAcrossMarkets(env);
  const seen = new Set(); // canonical venue slug

  for (const ev of events) {
    // No ID requirement here, unlike artists — venue pages resolve by a
    // keyword search on the venue name (routes/venuePage.js's
    // fetchVenueEvents), not by a Ticketmaster ID, so the same
    // eligibility bar eventsSitemap.js already uses (a real venue name)
    // is the right one: if it's good enough for an event to list, it's
    // good enough for that event's venue page to exist too.
    if (!ev.venue) continue;
    seen.add(venuePageRoutes.slugify(ev.venue));
  }

  const urls = [...seen.values()].map((slug) => `https://livefair24.com/venues/${slug}/`);
  return buildUrlsetXml(urls, SITEMAP_MARKETS.join(', '));
}

module.exports = { generateArtistsSitemapXml, generateVenuesSitemapXml };
