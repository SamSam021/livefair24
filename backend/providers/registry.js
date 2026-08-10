// providers/registry.js
//
// Auto-discovers every file in providers/tickets/ and providers/hotels/,
// and exposes helpers to get only the ones that are "enabled" (i.e. their
// required env vars — from .env OR the admin panel — are present).
//
// Also merges in "custom providers" registered by name through the admin
// panel (see config-store.js + genericAdapter.js) — those don't have a
// dedicated file, so they're wrapped into the same provider shape here at
// request time, live, with no restart needed after adding one.

const fs = require('fs');
const path = require('path');
const configStore = require('../config-store');
const { genericTicketSearch, genericHotelSearch } = require('./genericAdapter');

function loadProviders(dir) {
  const fullDir = path.join(__dirname, dir);
  if (!fs.existsSync(fullDir)) return [];
  return fs
    .readdirSync(fullDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => require(path.join(fullDir, f)));
}

const ticketProviders = loadProviders('tickets'); // built-in adapter files (demo, ticketmaster, seatgeek)
const hotelProviders = loadProviders('hotels');   // built-in adapter files (demo, amadeus, hotelbeds)
const emailProviders = loadProviders('email');    // built-in adapter files (demo, sendgrid, resend)

function wrapCustomProvider(def, searchFn) {
  return {
    id: def.id,
    name: def.name,
    custom: true,
    isEnabled: () => true, // already filtered to enabled ones before wrapping
    search: (params) => searchFn(def, params),
  };
}

function getEnabledTicketProviders(env) {
  const staticReal = ticketProviders.filter((p) => p.id !== 'demo' && p.isEnabled(env));
  const customReal = configStore
    .getCustomProviders('ticket')
    .filter((p) => p.enabled)
    .map((def) => wrapCustomProvider(def, genericTicketSearch));
  const real = staticReal.concat(customReal);
  if (real.length > 0) return real;
  return ticketProviders.filter((p) => p.id === 'demo');
}

function getEnabledHotelProviders(env) {
  const staticReal = hotelProviders.filter((p) => p.id !== 'demo' && p.isEnabled(env));
  const customReal = configStore
    .getCustomProviders('hotel')
    .filter((p) => p.enabled)
    .map((def) => wrapCustomProvider(def, genericHotelSearch));
  const real = staticReal.concat(customReal);
  if (real.length > 0) return real;
  return hotelProviders.filter((p) => p.id === 'demo');
}

// Email is different from tickets/hotels: we want exactly ONE active sender,
// not an aggregated list. Preference order: first real provider that's
// enabled (in the order its file was loaded), falling back to demo.
function getActiveEmailProvider(env) {
  const real = emailProviders.find((p) => p.id !== 'demo' && p.isEnabled(env));
  return real || emailProviders.find((p) => p.id === 'demo');
}

// Merges process.env with credentials saved via the admin panel — admin
// panel values win if both are set. Call this instead of reading
// process.env directly wherever provider env is needed.
function getMergedEnv() {
  return Object.assign({}, process.env, configStore.getCredentials());
}

module.exports = {
  ticketProviders,
  hotelProviders,
  emailProviders,
  getEnabledTicketProviders,
  getEnabledHotelProviders,
  getActiveEmailProvider,
  getMergedEnv,
};
