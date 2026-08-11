// cookie-banner.js — full consent management:
//   1. A simple banner (Accept all / Decline non-essential / Manage preferences)
//   2. A "Manage preferences" panel with per-category toggles (Necessary,
//      Analytics, Marketing) — Necessary is always on and can't be turned off
//   3. A persistent "Cookie settings" tab to reopen and change the choice
//      later (withdrawal must be as easy as consent)
//   4. Real enforcement: any <script> that should only run after consent
//      must be marked type="text/plain" with data-consent-category="analytics"
//      (or "marketing") instead of a normal type="text/javascript" — browsers
//      never execute type="text/plain" scripts, so nothing runs until this
//      file explicitly activates it after consent is given. See the README
//      note at the bottom of this file for exactly how to add a real script.
//
// This is real production site code (not a Claude artifact), so
// localStorage is the correct, standard tool here.

(function () {
  var STORAGE_KEY = 'livefair24_cookie_consent';
  var CATEGORIES = ['analytics', 'marketing']; // "necessary" is implicit and always true

  function getConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveConsent(categoryValues) {
    var record = { necessary: true, decidedAt: new Date().toISOString() };
    CATEGORIES.forEach(function (c) {
      record[c] = !!categoryValues[c];
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) {
      /* ignore — private browsing or storage disabled */
    }
    activateConsentedScripts(record);
  }

  // Finds every placeholder script for a now-accepted category and turns
  // it into a real, executing script. This is the actual enforcement step —
  // everything before this point is just UI.
  function activateConsentedScripts(record) {
    CATEGORIES.forEach(function (category) {
      if (!record[category]) return;
      var placeholders = document.querySelectorAll(
        'script[type="text/plain"][data-consent-category="' + category + '"]'
      );
      placeholders.forEach(function (placeholder) {
        var real = document.createElement('script');
        for (var i = 0; i < placeholder.attributes.length; i++) {
          var attr = placeholder.attributes[i];
          if (attr.name === 'type') continue; // skip, we set our own below
          real.setAttribute(attr.name, attr.value);
        }
        real.type = 'text/javascript';
        if (placeholder.textContent) real.textContent = placeholder.textContent;
        placeholder.parentNode.replaceChild(real, placeholder);
      });
    });
  }

  function buildBannerHTML() {
    return (
      '<div class="cookie-banner-inner">' +
        '<p>We use cookies for essential site functionality and, with your permission, to understand site usage. ' +
          '<button type="button" class="cookie-link-btn" id="cookieManage">Manage preferences</button> or see our ' +
          '<a href="/privacy.html">Privacy &amp; Cookie Policy</a>.</p>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="cookie-btn cookie-btn-decline" id="cookieDecline">Decline non-essential</button>' +
          '<button type="button" class="cookie-btn cookie-btn-accept" id="cookieAccept">Accept all</button>' +
        '</div>' +
      '</div>'
    );
  }

  function buildPreferencesHTML() {
    return (
      '<div class="cookie-banner-inner cookie-prefs">' +
        '<h3>Cookie preferences</h3>' +
        '<div class="cookie-cat-row">' +
          '<div><strong>Necessary</strong><span>Required for the site to function. Always on.</span></div>' +
          '<label class="cookie-toggle cookie-toggle-locked"><input type="checkbox" checked disabled></label>' +
        '</div>' +
        '<div class="cookie-cat-row">' +
          '<div><strong>Analytics</strong><span>Helps us understand how visitors use the site.</span></div>' +
          '<label class="cookie-toggle"><input type="checkbox" id="cookieCatAnalytics"></label>' +
        '</div>' +
        '<div class="cookie-cat-row">' +
          '<div><strong>Marketing</strong><span>Used to measure the effectiveness of affiliate links.</span></div>' +
          '<label class="cookie-toggle"><input type="checkbox" id="cookieCatMarketing"></label>' +
        '</div>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="cookie-btn cookie-btn-decline" id="cookieSavePrefs">Save preferences</button>' +
          '<button type="button" class="cookie-btn cookie-btn-accept" id="cookieAcceptFromPrefs">Accept all</button>' +
        '</div>' +
      '</div>'
    );
  }

  function showBanner(startInPrefsView) {
    var existing = document.getElementById('cookieBanner');
    if (existing) existing.remove();
    hideToggle();

    var el = document.createElement('div');
    el.id = 'cookieBanner';
    el.className = 'cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie notice');
    el.innerHTML = startInPrefsView ? buildPreferencesHTML() : buildBannerHTML();
    document.body.appendChild(el);
    wireUpView(el, startInPrefsView);
  }

  function wireUpView(el, isPrefsView) {
    if (!isPrefsView) {
      document.getElementById('cookieManage').addEventListener('click', function () {
        showBanner(true);
      });
      document.getElementById('cookieAccept').addEventListener('click', function () {
        saveConsent({ analytics: true, marketing: true });
        el.remove();
        showToggle();
      });
      document.getElementById('cookieDecline').addEventListener('click', function () {
        saveConsent({ analytics: false, marketing: false });
        el.remove();
        showToggle();
      });
    } else {
      document.getElementById('cookieAcceptFromPrefs').addEventListener('click', function () {
        saveConsent({ analytics: true, marketing: true });
        el.remove();
        showToggle();
      });
      document.getElementById('cookieSavePrefs').addEventListener('click', function () {
        saveConsent({
          analytics: document.getElementById('cookieCatAnalytics').checked,
          marketing: document.getElementById('cookieCatMarketing').checked,
        });
        el.remove();
        showToggle();
      });
    }
  }

  function buildToggle() {
    if (document.getElementById('cookieSettingsToggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'cookieSettingsToggle';
    btn.className = 'cookie-settings-toggle';
    btn.setAttribute('aria-label', 'Cookie settings — change your choice');
    btn.title = 'Cookie settings';
    btn.textContent = '🍪';
    btn.addEventListener('click', function () {
      showBanner(true);
    });
    document.body.appendChild(btn);
  }

  function hideToggle() {
    var t = document.getElementById('cookieSettingsToggle');
    if (t) t.style.display = 'none';
  }

  function showToggle() {
    var t = document.getElementById('cookieSettingsToggle');
    if (t) t.style.display = 'flex';
  }

  function init() {
    buildToggle();
    var existing = getConsent();
    if (!existing) {
      showBanner(false);
    } else {
      activateConsentedScripts(existing); // re-activate on every page load based on saved choice
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ============================================================
   HOW TO ADD A REAL TRACKING SCRIPT LATER (e.g. Google Analytics):

   Don't add it as a normal <script src="..."> tag — that would run
   before consent. Instead, mark it inert and tag its category:

     <script type="text/plain" data-consent-category="analytics"
             src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX">
     </script>

   type="text/plain" means the browser will NOT execute it. This file
   automatically finds and activates it (turns it into a real, running
   script) the moment the visitor accepts the "analytics" category —
   on this page load if they already consented, or immediately after
   they click Accept/Save if they're deciding right now.

   Do the same for a marketing/ad pixel with
   data-consent-category="marketing".
   ============================================================ */
