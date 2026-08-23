// js/i18n.js
//
// Pure client-side text-swapping layer. Runs AFTER the page has
// already loaded and been server-rendered — deliberately never touches
// <title>, meta tags, canonical URLs, JSON-LD, or any other SEO
// signal, since all of that lives in the raw HTML a crawler reads
// before this script ever runs. This only changes what a real visitor
// SEES in their browser, nothing about what gets indexed.
//
// Usage: any element with data-i18n="path.to.key" gets its
// textContent replaced with that key's translated string once the
// dictionary loads. Elements needing a placeholder/title/aria-label
// instead of textContent use data-i18n-attr="placeholder" alongside
// data-i18n to target that attribute instead.

(function () {
  async function loadLanguage() {
    try {
      const res = await fetch('/api/language');
      if (!res.ok) return null;
      return res.json();
    } catch (err) {
      console.warn('[i18n] could not load language/dictionary', err);
      return null;
    }
  }

  function getNested(obj, path) {
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
  }

  function applyTranslations(dictionary) {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const value = getNested(dictionary, key);
      if (value === undefined) return; // missing key — leave the original English text in place rather than showing nothing
      const attr = el.getAttribute('data-i18n-attr');
      if (attr) {
        el.setAttribute(attr, value);
      } else {
        el.textContent = value;
      }
    });
  }

  async function setLanguage(language) {
    await fetch('/api/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    });
    const data = await loadLanguage();
    if (data && data.dictionary) applyTranslations(data.dictionary);
    document.documentElement.setAttribute('lang', language);
    window.dispatchEvent(new CustomEvent('languagechange-lf24', { detail: { language } }));
  }

  async function init() {
    const data = await loadLanguage();
    if (!data || !data.dictionary) return;
    applyTranslations(data.dictionary);
    document.documentElement.setAttribute('lang', data.language);
    window.__LF24_DICTIONARY__ = data.dictionary; // exposed for any page-specific JS that needs a translated string outside a data-i18n element (e.g. a dynamically-built card)
    window.__LF24_LANGUAGE__ = data.language;
    const switcher = document.getElementById('languageSwitcher');
    if (switcher) switcher.value = data.language;
  }

  window.LF24_setLanguage = setLanguage;
  document.addEventListener('DOMContentLoaded', init);
})();
