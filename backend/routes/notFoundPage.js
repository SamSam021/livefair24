// routes/notFoundPage.js
//
// A single, reusable styled "not found" page — real nav, real footer,
// matching every other page's actual design. Confirmed real UX gap,
// reported directly with a screenshot: several routes (venues, artists,
// events, cities) were returning a bare plain-text string with zero
// styling and no way back into the site on a 404. Not every one of
// those call sites has been switched over to this yet — this module
// exists so each can be, one at a time, without duplicating the same
// nav/footer markup in every route file.

function renderNotFoundPage({ heading, message, suggestions = [] }) {
  const suggestionLinks = suggestions
    .map((s) => `<a href="${s.href}" class="pill">${s.label}</a>`)
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${heading} | LiveFair24</title>
<meta name="robots" content="noindex, follow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v=2026081a4">
</head>
<body>

<nav class="site-nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo"><span class="dot"></span>LiveFair24</a>
    <div class="nav-links" id="navLinks">
      <a href="/cities/">Browse cities</a>
      <a href="/concerts/">Concerts</a>
      <a href="/artists/">Artists</a>
      <a href="/venues/">Venues</a>
      <a href="/guides/how-it-works.html">How it works</a>
      <a href="/sports/">Sports</a>
    </div>
    <div class="nav-right">
      <a href="/search/" class="nav-cta">Search concerts</a>
      <button class="nav-burger" id="navBurger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="navLinks">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</nav>
<script>
(function(){
  var btn=document.getElementById('navBurger'), links=document.getElementById('navLinks');
  if(!btn||!links) return;
  btn.addEventListener('click', function(){
    var open = links.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  links.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', function(){
      links.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
    });
  });
})();
</script>

<main>
<div class="container">
  <section style="padding:64px 0;max-width:60ch;text-align:center;margin:0 auto;">
    <h1 class="display" style="font-size:clamp(24px,4vw,34px);margin-bottom:14px;">${heading}</h1>
    <p style="font-size:15px;color:var(--ink-dim);line-height:1.7;margin-bottom:28px;">${message}</p>
    ${suggestions.length ? `<div class="pill-row" style="justify-content:center;">\n        ${suggestionLinks}\n      </div>` : ''}
  </section>
</div>
</main>

<footer class="site-footer">
  <div class="footer-inner">
    <div>
      <div class="footer-logo">● LiveFair24</div>
      <p class="footer-tagline">Concert ticket search + hotels + total trip cost.</p>
    </div>
    <div class="footer-col">
      <h4>Browse</h4>
      <ul>
        <li><a href="/cities/">All cities</a></li>
        <li><a href="/artists/">Artists</a></li>
        <li><a href="/venues/">Venues</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h4>Company</h4>
      <ul>
        <li><a href="/about.html">About</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2026 LiveFair24. We earn affiliate commission on purchases made through our links.</span>
  </div>
</footer>

</body>
</html>`;
}

module.exports = { renderNotFoundPage };
