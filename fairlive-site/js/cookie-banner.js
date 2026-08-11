// cookie-banner.js — shows a cookie consent banner on first visit, and a
// persistent "Cookie settings" tab that lets the visitor reopen it and
// change their choice at any time (GDPR/TTDSG require withdrawal to be as
// easy as giving consent). Remembers the choice in localStorage. This is
// real production site code (not a Claude artifact), so localStorage is
// the correct, standard tool here.

(function () {
  var STORAGE_KEY = 'livefair24_cookie_consent';

  function getChoice() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null; // if storage is blocked, treat as undecided rather than crash
    }
  }

  function remember(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* ignore — private browsing or storage disabled */
    }
  }

  function showBanner() {
    if (document.getElementById('cookieBanner')) return; // already open
    hideToggle();

    var el = document.createElement('div');
    el.id = 'cookieBanner';
    el.className = 'cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie notice');
    el.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<p>We use cookies for essential site functionality and to improve your experience. See our <a href="/privacy.html">Privacy &amp; Cookie Policy</a> for details.</p>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="cookie-btn cookie-btn-decline" id="cookieDecline">Decline non-essential</button>' +
          '<button type="button" class="cookie-btn cookie-btn-accept" id="cookieAccept">Accept all</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    document.getElementById('cookieAccept').addEventListener('click', function () {
      remember('accepted');
      el.remove();
      showToggle();
    });
    document.getElementById('cookieDecline').addEventListener('click', function () {
      remember('declined');
      el.remove();
      showToggle();
    });
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
    btn.addEventListener('click', showBanner);
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
    if (!getChoice()) {
      showBanner();
    }
    // If a choice already exists, the toggle stays visible by default
    // (its CSS default is visible) so it's always reachable to change later.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
