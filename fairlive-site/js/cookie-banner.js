// cookie-banner.js — shows a cookie consent banner on first visit.
// Remembers the choice in localStorage so it doesn't show again once
// accepted. This is real production site code (not a Claude artifact),
// so localStorage is the correct, standard tool here.

(function () {
  var STORAGE_KEY = 'livefair24_cookie_consent';

  function alreadyDecided() {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return false; // if storage is blocked, just show the banner every time rather than crash
    }
  }

  function remember(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* ignore — private browsing or storage disabled */
    }
  }

  function buildBanner() {
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
    });
    document.getElementById('cookieDecline').addEventListener('click', function () {
      remember('declined');
      el.remove();
    });
  }

  if (!alreadyDecided()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', buildBanner);
    } else {
      buildBanner();
    }
  }
})();
