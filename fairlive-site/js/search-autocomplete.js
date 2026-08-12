// search-autocomplete.js
//
// Adds a live dropdown of suggestions under any <input class="search-input">
// inside a <form class="search-form">. Reuses the existing /api/search
// endpoint — no separate backend route needed, since it already does
// exactly the multi-source-aggregation-sorted-by-price search this needs.
//
// Deliberately debounced + minimum-character-gated + cancels stale
// requests: firing a real API call (Ticketmaster, and later other sources)
// on every single keystroke would burn through provider rate limits fast.
// See DEBOUNCE_MS / MIN_CHARS below.

(function () {
  const DEBOUNCE_MS = 300;
  const MIN_CHARS = 2;
  const MAX_SUGGESTIONS = 6;

  function initAutocomplete(form) {
    const input = form.querySelector('.search-input');
    if (!input) return;

    // Wrap the input so the dropdown can be positioned relative to it,
    // without disturbing whatever layout already contains the form.
    const wrap = document.createElement('div');
    wrap.className = 'search-autocomplete-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const dropdown = document.createElement('div');
    dropdown.className = 'search-suggestions';
    dropdown.style.display = 'none';
    dropdown.setAttribute('role', 'listbox');
    wrap.appendChild(dropdown);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');

    let debounceTimer = null;
    let abortController = null;
    let activeIndex = -1;

    function closeDropdown() {
      dropdown.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
    }

    function updateActiveHighlight() {
      dropdown.querySelectorAll('.search-suggestion-item').forEach((item, i) => {
        item.classList.toggle('active', i === activeIndex);
      });
    }

    function selectItem(item) {
      const url = item.dataset.url;
      if (url && url !== '#' && url !== 'undefined') {
        window.open(url, '_blank', 'noopener');
      } else {
        // Dispatching a real 'submit' event (not calling form.submit()
        // directly) matters here: form.submit() bypasses the 'submit'
        // event entirely, which would silently break any page — like
        // /search/ — that has its own custom submit handler instead of
        // relying on native GET navigation.
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }

    function renderSuggestions(results) {
      activeIndex = -1;
      if (results.length === 0) {
        dropdown.innerHTML = '<div class="search-suggestion-empty">No matches yet — press Enter to search anyway.</div>';
        dropdown.style.display = 'block';
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      dropdown.innerHTML = results.slice(0, MAX_SUGGESTIONS).map((r) => `
        <div class="search-suggestion-item" role="option" data-url="${r.url || ''}">
          <div>
            <div class="search-suggestion-name">${r.name || 'Untitled event'}</div>
            <div class="search-suggestion-meta">${[r.venue, r.city].filter(Boolean).join(', ')}${r.date ? ' · ' + r.date : ''}</div>
          </div>
          <div class="search-suggestion-price">${r.lowestPrice != null ? '$' + Number(r.lowestPrice).toFixed(0) : ''}</div>
        </div>`).join('');
      dropdown.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');

      dropdown.querySelectorAll('.search-suggestion-item').forEach((item) => {
        item.addEventListener('click', () => selectItem(item));
      });
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (abortController) abortController.abort();

      if (q.length < MIN_CHARS) {
        closeDropdown();
        return;
      }

      debounceTimer = setTimeout(async () => {
        abortController = new AbortController();
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: abortController.signal });
          if (!res.ok) return;
          const data = await res.json();
          // Guard against the input having changed again while this was in flight.
          if (input.value.trim() === q) renderSuggestions(data.results || []);
        } catch (err) {
          if (err.name !== 'AbortError') console.error(err);
        }
      }, DEBOUNCE_MS);
    });

    input.addEventListener('keydown', (e) => {
      if (dropdown.style.display === 'none') return;
      const items = dropdown.querySelectorAll('.search-suggestion-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        updateActiveHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, -1);
        updateActiveHighlight();
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && items[activeIndex]) {
          e.preventDefault();
          selectItem(items[activeIndex]);
        }
        // else: no suggestion highlighted, let the form submit normally
      } else if (e.key === 'Escape') {
        closeDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closeDropdown();
    });
  }

  function init() {
    document.querySelectorAll('form.search-form').forEach(initAutocomplete);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
