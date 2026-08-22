// venue-content-store.js
//
// Persists admin-authored content for real venues — About the venue, How
// to get there, Address, Public transport, Parking, Seating information.
// Each is independently enable/disable-able: unticked means the whole
// section (heading + body) never renders; ticked means it always renders,
// even with empty body text. If a venue has NO entry here at all, the
// venue page renders exactly as it did before this feature existed — this
// store is purely additive, never a replacement for the real,
// live-Ticketmaster-driven parts of a venue page (upcoming events stay
// 100% real data, never admin-authored).
//
// Keyed by Ticketmaster's own real venue ID (see providers/tickets/
// ticketmaster.js's venueId field) — not a name or slug, since names can
// collide across cities and slugs can silently drift if a venue's name
// ever changes in Ticketmaster's own data.
//
// Backed by persistence.js (DynamoDB or local file), same pattern as
// config-store.js — one JSON document holding every venue's content,
// which is a reasonable shape at the dozens-to-low-hundreds scale this
// admin panel manages (not an unbounded per-request table).

const persistence = require('./persistence');

const SECTION_KEYS = ['about', 'howToGetThere', 'address', 'publicTransport', 'parking', 'seating'];

function defaultStore() {
  return { venues: {} }; // venueId -> { venueName, city, country, sections: { about: {enabled, text}, ... }, updatedAt }
}

let store = defaultStore();

async function init() {
  store = await persistence.loadState('venue-content', defaultStore());
}

function persist() {
  persistence.saveState('venue-content', store).catch((err) => {
    console.error('[venue-content-store] Failed to persist:', err.message);
  });
}

function emptySections() {
  const sections = {};
  for (const key of SECTION_KEYS) sections[key] = { enabled: false, text: '' };
  return sections;
}

module.exports = {
  init,
  SECTION_KEYS,

  getVenueContent(venueId) {
    return store.venues[venueId] || null;
  },

  getAllVenueContent() {
    return { ...store.venues };
  },

  // sections only needs to include the keys being changed — merged onto
  // whatever's already saved (or the default all-disabled shape for a
  // brand new venue), so a save from the admin UI never has to resend
  // every section just to update one.
  saveVenueContent(venueId, { venueName, city, country, sections }) {
    const existing = store.venues[venueId] || { venueName, city, country, sections: emptySections() };
    store.venues[venueId] = {
      venueName: venueName || existing.venueName,
      city: city || existing.city,
      country: country || existing.country,
      sections: { ...existing.sections, ...sections },
      updatedAt: new Date().toISOString(),
    };
    persist();
    return store.venues[venueId];
  },

  deleteVenueContent(venueId) {
    delete store.venues[venueId];
    persist();
  },
};
