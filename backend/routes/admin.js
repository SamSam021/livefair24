// routes/admin.js
//
// Handlers for everything under /admin/api/*. All of these (except login)
// are called only after admin-auth middleware in server.js has verified the
// session cookie.

const crypto = require('crypto');
const configStore = require('../config-store');
const registry = require('../providers/registry');
const watchersStore = require('../watchers-store');
const venueContentStore = require('../venue-content-store');
const { runPriceCheck } = require('../price-check');

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return '•'.repeat(Math.max(0, value.length - 4)) + value.slice(-4);
}

// Built-in providers (from the adapter files) + which of their required env
// vars are currently set (via .env or the admin panel), masked.
function getBuiltInStatus() {
  const env = registry.getMergedEnv();
  const describe = (list) =>
    list
      .filter((p) => p.id !== 'demo')
      .map((p) => ({
        id: p.id,
        name: p.name,
        requiredEnv: p.requiredEnv,
        values: Object.fromEntries((p.requiredEnv || []).map((k) => [k, maskSecret(env[k])])),
        enabled: p.isEnabled(env),
      }));
  return {
    tickets: describe(registry.ticketProviders),
    hotels: describe(registry.hotelProviders),
    email: describe(registry.emailProviders),
  };
}

function getCustomStatus() {
  const mask = (p) => ({ ...p, apiKey: maskSecret(p.apiKey) });
  return {
    tickets: configStore.getCustomProviders('ticket').map(mask),
    hotels: configStore.getCustomProviders('hotel').map(mask),
  };
}

function getConfig() {
  return { builtIn: getBuiltInStatus(), custom: getCustomStatus() };
}

function setCredential(body) {
  if (!body.key || typeof body.value !== 'string') {
    throw Object.assign(new Error('key and value are required'), { statusCode: 400 });
  }
  configStore.setCredential(body.key, body.value);
  return { ok: true };
}

function deleteCredential(key) {
  configStore.deleteCredential(key);
  return { ok: true };
}

function upsertCustomProvider(body) {
  if (!body.name || !body.category || !body.baseUrl) {
    throw Object.assign(new Error('name, category, and baseUrl are required'), { statusCode: 400 });
  }
  if (!['ticket', 'hotel'].includes(body.category)) {
    throw Object.assign(new Error("category must be 'ticket' or 'hotel'"), { statusCode: 400 });
  }
  const def = {
    id: body.id || `custom_${crypto.randomBytes(6).toString('hex')}`,
    category: body.category,
    name: body.name,
    enabled: body.enabled !== false,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey || '',
    authType: body.authType === 'header' ? 'header' : 'query',
    apiKeyParam: body.apiKeyParam || 'api_key',
    headerName: body.headerName || 'Authorization',
    queryParam: body.queryParam || 'q',
    itemsPath: body.itemsPath || '',
    currency: body.currency || 'USD',
    fields: {
      name: body.fields?.name || '',
      price: body.fields?.price || '',
      url: body.fields?.url || '',
      rating: body.fields?.rating || '',
      distanceKm: body.fields?.distanceKm || '',
      lat: body.fields?.lat || '',
      lng: body.fields?.lng || '',
    },
  };
  configStore.upsertCustomProvider(def);
  return { ok: true, id: def.id };
}

function deleteCustomProvider(id) {
  configStore.deleteCustomProvider(id);
  return { ok: true };
}

function toggleCustomProvider(id, enabled) {
  configStore.toggleCustomProvider(id, enabled);
  return { ok: true };
}

function getWatcherStats() {
  const all = watchersStore.getAll();
  const active = all.filter((w) => w.active);
  const byEvent = {};
  for (const w of active) {
    byEvent[w.eventId] = byEvent[w.eventId] || { eventId: w.eventId, artist: w.artist, city: w.city, count: 0 };
    byEvent[w.eventId].count++;
  }
  return {
    totalActive: active.length,
    totalUnsubscribed: all.length - active.length,
    byEvent: Object.values(byEvent),
  };
}

function getDemoEmailLog() {
  const demoProvider = registry.emailProviders.find((p) => p.id === 'demo');
  return demoProvider && demoProvider.getSentLog ? demoProvider.getSentLog().slice(-30).reverse() : [];
}

async function triggerPriceCheck() {
  return runPriceCheck();
}

// Real venues currently found in live Ticketmaster data for a given
// country/city — the admin panel's picker uses this so a venue is
// selected from what genuinely exists right now, not typed blind. Not
// filtered to music-only (allCategories:true) — a venue worth writing
// "How to get there" content for might primarily host sports or other
// event types, admin content shouldn't be blocked by that.
async function searchVenues(query) {
  const country = (query.country || '').toUpperCase();
  const city = query.city || '';
  if (!country) throw Object.assign(new Error('country is required'), { statusCode: 400 });

  const env = registry.getMergedEnv();
  const tm = registry.ticketProviders.find((p) => p.id === 'ticketmaster');
  if (!tm || !tm.isEnabled(env) || typeof tm.searchEvents !== 'function') return { venues: [] };

  const results = await tm.searchEvents({ query: '', city, countryCode: country, limit: 200, allCategories: true }, env);
  if (!Array.isArray(results)) return { venues: [] };

  const byVenueId = new Map();
  for (const ev of results) {
    if (!ev.venueId || !ev.venue) continue;
    if (!byVenueId.has(ev.venueId)) {
      byVenueId.set(ev.venueId, { venueId: ev.venueId, venueName: ev.venue, city: ev.city, country, eventCount: 0 });
    }
    byVenueId.get(ev.venueId).eventCount += 1;
  }
  const venues = Array.from(byVenueId.values()).sort((a, b) => b.eventCount - a.eventCount);
  return { venues };
}

function getVenueContent(venueId) {
  if (!venueId) throw Object.assign(new Error('venueId is required'), { statusCode: 400 });
  const existing = venueContentStore.getVenueContent(venueId);
  if (existing) return existing;
  // No saved content yet for this venue — return the same shape with
  // every section disabled/empty, so the admin UI has a consistent
  // form to render regardless of whether this venue has been touched
  // before.
  const sections = {};
  for (const key of venueContentStore.SECTION_KEYS) sections[key] = { enabled: false, text: '' };
  return { venueName: '', city: '', country: '', sections };
}

function saveVenueContent(venueId, body) {
  if (!venueId) throw Object.assign(new Error('venueId is required'), { statusCode: 400 });
  if (!body.sections || typeof body.sections !== 'object') {
    throw Object.assign(new Error('sections object is required'), { statusCode: 400 });
  }
  // Only accept known section keys with the expected {enabled, text}
  // shape — never persist an admin-supplied key this store doesn't
  // know about.
  const sections = {};
  for (const key of venueContentStore.SECTION_KEYS) {
    if (body.sections[key]) {
      sections[key] = {
        enabled: !!body.sections[key].enabled,
        text: typeof body.sections[key].text === 'string' ? body.sections[key].text : '',
      };
    }
  }
  return venueContentStore.saveVenueContent(venueId, {
    venueName: body.venueName,
    city: body.city,
    country: body.country,
    sections,
  });
}

function deleteVenueContent(venueId) {
  if (!venueId) throw Object.assign(new Error('venueId is required'), { statusCode: 400 });
  venueContentStore.deleteVenueContent(venueId);
  return { ok: true };
}

module.exports = {
  getConfig,
  setCredential,
  deleteCredential,
  upsertCustomProvider,
  deleteCustomProvider,
  toggleCustomProvider,
  getWatcherStats,
  getDemoEmailLog,
  triggerPriceCheck,
  searchVenues,
  getVenueContent,
  saveVenueContent,
  deleteVenueContent,
};
