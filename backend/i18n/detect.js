// i18n/detect.js
//
// Decides which language a request should render in: an explicit
// manual choice (a real cookie, set only when someone actually uses
// the language switcher) always wins; otherwise falls back to the
// visitor's real detected country via the same ipapi.co lookup
// trending.js already uses for country-based event results — no new
// geolocation call, just a second use of the same real IP lookup.
//
// Mapping is explicit and literal, per the exact requirement: Germany
// -> German, France -> French, Spain -> Spanish, Mexico -> Spanish,
// every other country -> English. Deliberately NOT a broad "all
// Spanish-speaking countries" or "all German-speaking countries" rule
// (e.g. Austria, Switzerland, Argentina are not included) — only the
// 4 countries explicitly named get anything other than English, so
// this never silently expands beyond what was actually asked for.

const ipapi = require('../providers/geo/ipapi');
const { parseCookies } = require('../admin-auth');

const SUPPORTED_LANGUAGES = ['en', 'de', 'fr', 'es'];
const LANGUAGE_COOKIE_NAME = 'lf24_lang';

const COUNTRY_TO_LANGUAGE = {
  DE: 'de',
  FR: 'fr',
  ES: 'es',
  MX: 'es',
};

function languageForCountry(countryCode) {
  return COUNTRY_TO_LANGUAGE[(countryCode || '').toUpperCase()] || 'en';
}

// Returns the real language this request should render in, and
// whether it came from an explicit user choice or IP-based detection
// (the frontend language switcher uses this second value to decide
// whether to show "detected" vs "your choice" in its own UI, if it
// ever wants to).
async function detectLanguage(req) {
  const cookies = parseCookies(req);
  const manual = cookies[LANGUAGE_COOKIE_NAME];
  if (manual && SUPPORTED_LANGUAGES.includes(manual)) {
    return { language: manual, source: 'manual' };
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const countryCode = await ipapi.getCountryCodeForIp(ip);
  return { language: languageForCountry(countryCode), source: 'ip', detectedCountry: countryCode };
}

module.exports = { detectLanguage, languageForCountry, SUPPORTED_LANGUAGES, LANGUAGE_COOKIE_NAME };
