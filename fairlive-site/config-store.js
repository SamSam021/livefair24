// config-store.js
//
// Persists everything the admin panel manages: credentials for the built-in
// providers, and definitions for custom providers registered by name.
//
// Backed by persistence.js (DynamoDB or local file, see that file). The
// public API here stays synchronous — an in-memory copy is kept up to date
// and read from directly, so registry.js and everything else that reads
// this store doesn't need to change. Call init() once at startup (server.js
// does this) to load the initial state before the server starts accepting
// requests; every write after that updates memory immediately and persists
// in the background.

const persistence = require('./persistence');

function defaultStore() {
  return { credentials: {}, customProviders: [] };
}

let store = defaultStore();

async function init() {
  store = await persistence.loadState('provider-config', defaultStore());
}

function persist() {
  persistence.saveState('provider-config', store).catch((err) => {
    console.error('[config-store] Failed to persist:', err.message);
  });
}

module.exports = {
  init,

  // ---- Credentials for built-in providers (e.g. TICKETMASTER_API_KEY) ----
  getCredentials() {
    return { ...store.credentials };
  },
  setCredential(key, value) {
    store.credentials[key] = value;
    persist();
  },
  deleteCredential(key) {
    delete store.credentials[key];
    persist();
  },

  // ---- Custom providers registered by name via the admin panel ----
  getCustomProviders(category) {
    const all = store.customProviders || [];
    return category ? all.filter((p) => p.category === category) : all;
  },
  upsertCustomProvider(def) {
    if (!store.customProviders) store.customProviders = [];
    const idx = store.customProviders.findIndex((p) => p.id === def.id);
    if (idx >= 0) store.customProviders[idx] = def;
    else store.customProviders.push(def);
    persist();
    return def;
  },
  deleteCustomProvider(id) {
    store.customProviders = (store.customProviders || []).filter((p) => p.id !== id);
    persist();
  },
  toggleCustomProvider(id, enabled) {
    const p = (store.customProviders || []).find((p) => p.id === id);
    if (p) {
      p.enabled = enabled;
      persist();
    }
    return p;
  },
};
