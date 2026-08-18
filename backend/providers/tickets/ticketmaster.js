// providers/tickets/ticketmaster.js
//
// Real adapter for the Ticketmaster Discovery API.
// Activates automatically once TICKETMASTER_API_KEY is set — no other code
// needs to change.
//
// VERIFIED against a real live key and real responses (August 2026) — the
// field shapes below (_embedded.events, dates.start.localDate,
// priceRanges[0].min, _embedded.venues[0].city.name, etc.) are confirmed
// correct, not just documented conventions. The one earlier mystery this
// surfaced: Ticketmaster's `city` filter is an EXACT string match against
// their internal venue city field (e.g. "Brooklyn" ≠ "New York" even
// though it's NYC) — don't assume metro-area matching.

const https = require('https');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Ticketmaster: could not parse response JSON'));
          }
        } else {
          reject(new Error(`Ticketmaster API returned ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    }).on('error', reject);
  });
}

module.exports = {
  id: 'ticketmaster',
  name: 'Ticketmaster',
  badge: 'TM',
  requiredEnv: ['TICKETMASTER_API_KEY'],
  isEnabled(env) {
    return !!env.TICKETMASTER_API_KEY;
  },

  // Confirmed via Ticketmaster's own official documentation (Inventory
  // Status API page): "This Price Ranges feature is currently only
  // supported in these markets: US, CA, AU, NZ, MX." Not an account
  // permission issue, not affected by query strategy — a hard product
  // limitation. Every other market (including DE, GB — both directly
  // tested against real onsale events) structurally never returns price
  // data through this API, regardless of how it's queried.
  pricingSupportedCountries: ['US', 'CA', 'AU', 'NZ', 'MX'],
  isCountrySupportedForPricing(countryCode) {
    return this.pricingSupportedCountries.includes(countryCode);
  },
  // Used when the requested country isn't in the list above — the
  // country to fall back to so trending can still show something real,
  // rather than nothing at all.
  getFallbackPricingCountry() {
    return 'US';
  },

  // Used by /api/tickets — price comparison for ONE already-known event
  // (every result here is treated as a competing seller for that event).
  //
  // Prefers a direct get-by-ID lookup (params.eventId) over the keyword
  // search below, for the exact same reason getEventDetails exists:
  // confirmed via real evidence (this event page's own screenshot vs. a
  // "No live prices available" result) that a keyword search on a full
  // event title — e.g. "Lady A: This Winter's Night Tour 2026" — can
  // fail to match or return a different, unpriced listing even when
  // Ticketmaster's own site has real live pricing for that exact event.
  // A known event ID sidesteps keyword matching entirely. Falls back to
  // the keyword search when no eventId is available (demo mode, or any
  // caller that only has an artist name to go on).
  async search(params, env) {
    if (params.eventId) {
      const detail = await this.getEventDetails(params.eventId, env);
      if (detail && detail.lowestPrice != null) {
        const total = Math.round(detail.lowestPrice * 100) / 100;
        const fees = Math.round(total * 0.15 * 100) / 100; // TM doesn't break out fees in this endpoint — estimate; refine if you get access to a fees-inclusive field
        return [{
          sellerId: 'ticketmaster',
          sellerName: 'Ticketmaster',
          badge: 'TM',
          faceValue: Math.round((total - fees) * 100) / 100,
          fees,
          total,
          currency: detail.currency || 'USD',
          rating: null,
          reviews: null,
          url: detail.url || '#',
          section: 'See seller for section/row',
          demo: false,
        }];
      }
      // Detail lookup found the event but genuinely has no price yet (or
      // the lookup itself failed) — fall through to the keyword search
      // below rather than giving up, in case that surfaces something.
    }

    const key = env.TICKETMASTER_API_KEY;
    const keyword = encodeURIComponent(params.artist || params.query || '');
    const city = params.city ? `&city=${encodeURIComponent(params.city)}` : '';
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${key}&keyword=${keyword}${city}&size=5`;

    try {
      const data = await httpGet(url);
      const events = (data._embedded && data._embedded.events) || [];
      const results = [];
      for (const ev of events) {
        const range = (ev.priceRanges && ev.priceRanges[0]) || null;
        if (!range) continue; // Ticketmaster doesn't always return prices for an event
        const total = Math.round(range.min * 100) / 100;
        const fees = Math.round(total * 0.15 * 100) / 100; // TM doesn't break out fees in this endpoint — estimate; refine if you get access to a fees-inclusive field
        results.push({
          sellerId: 'ticketmaster',
          sellerName: 'Ticketmaster',
          badge: 'TM',
          faceValue: Math.round((total - fees) * 100) / 100,
          fees,
          total,
          currency: range.currency || 'USD',
          rating: null, // Ticketmaster's public API doesn't expose a seller rating
          reviews: null,
          url: ev.url || '#',
          section: 'See seller for section/row',
          demo: false,
        });
      }
      return results;
    } catch (err) {
      console.warn('[ticketmaster provider]', err.message);
      return []; // fail soft — one provider erroring shouldn't break the whole comparison
    }
  },

  // Used by /api/search — find MULTIPLE matching events for a free-text
  // query, and/or a city, and/or a date range (each result is a distinct
  // event, not a competing seller for one event). This is the shape a real
  // search feature needs. Also used by /api/trending with countryCode set
  // and no keyword — "what's happening in this country" rather than "find
  // this specific thing".
  async searchEvents(params, env) {
    const key = env.TICKETMASTER_API_KEY;
    const size = params.limit || 10;
    const parts = [`apikey=${key}`, `size=${size}`];
    if (params.query) parts.push(`keyword=${encodeURIComponent(params.query)}`);
    if (params.city) parts.push(`city=${encodeURIComponent(params.city)}`);
    if (params.countryCode) parts.push(`countryCode=${encodeURIComponent(params.countryCode)}`);
    // Confirmed via a real discovery response: without this, a bare
    // country browse returns comedy shows, museum exhibits, and generic
    // club nights alongside actual concerts ("die Comedy Show",
    // "EXPLORADO - Abenteuermuseum" were both real results). This site is
    // about concerts specifically — sports has its own entirely separate
    // DB-backed system (routes/sports.js, /matches/ pages), so this
    // ticket-provider search is never legitimately used for anything but
    // concerts. Previously only applied when there was no keyword/city
    // (country-only browse), which is exactly why a plain city search —
    // used by /api/search and the "Other concerts" widget on event pages
    // — could surface a hockey game or theater show alongside real
    // concerts. Applied unconditionally now, city/keyword search included.
    //
    // EXCEPTION: params.allCategories — set only by the homepage's search
    // bar (never the dedicated /concerts/ page, which keeps the
    // restriction exactly as before) — deliberately skips this filter, so
    // a homepage search can surface anything real Ticketmaster actually
    // has, not just music. This is the one legitimate, intentional use of
    // this ticket-provider search for non-concert results.
    if (!params.allCategories) parts.push('classificationName=music');
    // "Trending" here means Ticketmaster's own relevance sort — UNVERIFIED
    // exactly what signals that uses (likely some mix of popularity and
    // date proximity per their docs), not independently confirmed against
    // a real response. Falls back to date order if this isn't respected.
    // "Trending" here means soonest-upcoming, not relevance-sorted —
    // switched after confirming via a real request that relevance sort
    // was surfacing far-future, just-announced tour dates with no
    // pricing populated yet. Events happening sooner are far more likely
    // to already have real on-sale pricing.
    if (params.countryCode && !params.query) parts.push('sort=date,asc');
    // Ticketmaster expects startDateTime/endDateTime as full ISO 8601 with
    // a trailing Z (UTC) — e.g. 2026-09-01T00:00:00Z. UNVERIFIED: unlike
    // keyword/city (confirmed working against a real live call earlier),
    // these two params are from documented conventions only — I haven't
    // actually tested them against Ticketmaster's real system. Worth
    // confirming with a real date-filtered search before relying on it.
    if (params.dateFrom) parts.push(`startDateTime=${encodeURIComponent(params.dateFrom)}`);
    if (params.dateTo) parts.push(`endDateTime=${encodeURIComponent(params.dateTo)}`);
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?${parts.join('&')}`;

    try {
      const data = await httpGet(url);
      const events = (data._embedded && data._embedded.events) || [];
      return events.map(mapEventToResult);
    } catch (err) {
      console.warn('[ticketmaster provider] searchEvents', err.message);
      return [];
    }
  },

  // Fetches ONE event by its real Ticketmaster ID directly, instead of
  // re-searching by keyword. Added after confirming — with real evidence
  // across two different countries (DE and GB), both showing confirmed
  // onsale, well-known artists — that neither sort order, keyword
  // re-search, nor onsale-status filtering ever surfaced priceRanges
  // data. The one thing not yet tried: REST APIs commonly return more
  // complete data from a get-by-ID detail endpoint than from a list/
  // search endpoint, even for the same underlying resource. UNVERIFIED
  // against a live call, same as several other pieces here — this is a
  // genuinely different hypothesis, not a guess dressed up as one.
  async getEventDetails(eventId, env) {
    const key = env.TICKETMASTER_API_KEY;
    const url = `https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(eventId)}.json?apikey=${key}`;
    try {
      const ev = await httpGet(url);
      return mapEventToResult(ev);
    } catch (err) {
      console.warn('[ticketmaster provider] getEventDetails', err.message);
      return null;
    }
  },
};

// Shared per-event mapping — used by both the list/search endpoint
// (searchEvents, where each item comes from _embedded.events[]) and the
// get-by-ID detail endpoint (getEventDetails, where the whole response
// IS one such event object). Kept as one function so both code paths
// stay in sync rather than risking the two silently drifting apart.
// Ticketmaster returns multiple images per event (different ratios and
// sizes — 16:9, 3:2, 1:1, various widths) since they serve everything
// from hero banners to thumbnails. For a small card image, this prefers
// something roughly square-ish or landscape at a moderate width (not
// the largest available, no reason to load a full hero-banner image for
// a 44px card icon) and falls back to whatever's first if nothing
// matches that preference, or null if the event genuinely has no
// images at all — never fabricated, never a placeholder stock photo.
function pickBestImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const preferred = images.find((img) => img.width && img.width >= 200 && img.width <= 400);
  return (preferred || images[0]).url || null;
}

function mapEventToResult(ev) {
  const range = (ev.priceRanges && ev.priceRanges[0]) || null;
  const venue = (ev._embedded && ev._embedded.venues && ev._embedded.venues[0]) || null;
  const attraction = (ev._embedded && ev._embedded.attractions && ev._embedded.attractions[0]) || null;
  const genre = (ev.classifications && ev.classifications[0] && ev.classifications[0].segment) || null;
  return {
    source: 'ticketmaster',
    sourceLabel: 'Ticketmaster',
    name: ev.name,
    // The real attraction/artist ID — used to deduplicate multiple
    // tour dates (or ticket-tier variants like "... | Premium
    // Packages") of the same act down to one entry. Confirmed this
    // field exists in the real response captured earlier.
    attractionId: attraction ? attraction.id : null,
    // Ticketmaster's own event ID — the actual unique identifier
    // for this specific occurrence (this artist, this date, this
    // venue), distinct from attractionId which identifies the
    // artist across all their dates. Stored so the selected event
    // can be precisely identified later, per the requirement that
    // ticket/hotel lookups target the exact correct event.
    eventId: ev.id || null,
    // Confirmed real field from an earlier captured response
    // (dates.status.code: "onsale") — an event can be listed and
    // discoverable before tickets actually go on sale, which would
    // explain missing pricing regardless of query strategy. Using
    // this directly instead of guessing at more query parameters.
    saleStatus: ev.dates && ev.dates.status ? ev.dates.status.code : null,
    genre: genre ? genre.name : null,
    venue: venue ? venue.name : null,
    city: venue && venue.city ? venue.city.name : null,
    country: venue && venue.country ? venue.country.name : null,
    // Confirmed field names/shape (venue.location.latitude/longitude,
    // as strings) against the real response captured earlier in this
    // project — not a documented-but-untested guess like some of the
    // other fields here.
    lat: venue && venue.location ? parseFloat(venue.location.latitude) : null,
    lng: venue && venue.location ? parseFloat(venue.location.longitude) : null,
    date: ev.dates && ev.dates.start ? ev.dates.start.localDate : null,
    time: ev.dates && ev.dates.start ? ev.dates.start.localTime : null,
    lowestPrice: range ? range.min : null,
    currency: range ? range.currency : null,
    url: ev.url || '#',
    // Ticketmaster's own real promotional image for this event, when
    // they have one — never a placeholder or stock photo substituted
    // in when they don't.
    imageUrl: pickBestImage(ev.images),
  };
}
