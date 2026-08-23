// i18n/index.js
//
// Loads the 4 translation dictionaries once at startup (small JSON
// files, no reason to re-read from disk per request) and exposes them
// keyed by language code. Pure data — no route/architecture changes
// anywhere else in the app depend on this existing; it's consumed only
// by the new, additive /api/language endpoint and the client-side
// i18n.js it serves.

const en = require('./locales/en.json');
const de = require('./locales/de.json');
const fr = require('./locales/fr.json');
const es = require('./locales/es.json');

const DICTIONARIES = { en, de, fr, es };

function getDictionary(language) {
  return DICTIONARIES[language] || DICTIONARIES.en;
}

module.exports = { getDictionary, DICTIONARIES };
