// search-location.js
//
// Shows a dropdown of matching cities as the visitor types in the
// Location field. This is a curated static list, not a real geocoding
// API — no such service is connected yet. Being upfront about that in
// case this needs to become a real API-backed autocomplete later (e.g.
// if a hotel/geocoding provider gets added).

(function () {
  const CITIES = [
    'Berlin, Germany', 'Hamburg, Germany', 'Munich, Germany', 'Cologne, Germany',
    'Frankfurt, Germany', 'Bremen, Germany', 'Freiburg, Germany', 'Stuttgart, Germany',
    'Dusseldorf, Germany', 'Leipzig, Germany',
    'London, United Kingdom', 'Manchester, United Kingdom', 'Birmingham, United Kingdom',
    'Glasgow, United Kingdom', 'Bristol, United Kingdom',
    'Dublin, Ireland', 'Cork, Ireland',
    'Paris, France', 'Lyon, France', 'Marseille, France',
    'Milan, Italy', 'Rome, Italy', 'Turin, Italy', 'Naples, Italy',
    'Madrid, Spain', 'Barcelona, Spain', 'Valencia, Spain',
    'Amsterdam, Netherlands', 'Rotterdam, Netherlands',
    'Brussels, Belgium', 'Antwerp, Belgium',
    'Vienna, Austria', 'Zurich, Switzerland', 'Geneva, Switzerland',
    'Stockholm, Sweden', 'Copenhagen, Denmark', 'Oslo, Norway', 'Helsinki, Finland',
    'Lisbon, Portugal', 'Warsaw, Poland', 'Prague, Czech Republic',
    'New York, United States', 'Los Angeles, United States', 'Chicago, United States',
    'San Francisco, United States', 'Miami, United States', 'Austin, United States',
    'Nashville, United States', 'Seattle, United States', 'Boston, United States',
    'Atlanta, United States', 'Las Vegas, United States',
    'Toronto, Canada', 'Vancouver, Canada', 'Montreal, Canada',
    'Sydney, Australia', 'Melbourne, Australia', 'Brisbane, Australia',
    'Auckland, New Zealand',
    'Tokyo, Japan', 'Seoul, South Korea', 'Singapore, Singapore',
  ];

  const MIN_CHARS = 1;
  const MAX_SUGGESTIONS = 6;

  function initLocationAutocomplete(input) {
    const wrap = document.createElement('div');
    wrap.className = 'search-autocomplete-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const dropdown = document.createElement('div');
    dropdown.className = 'search-suggestions';
    dropdown.style.display = 'none';
    wrap.appendChild(dropdown);

    function closeDropdown() {
      dropdown.style.display = 'none';
    }

    function renderMatches(matches) {
      if (matches.length === 0) {
        closeDropdown();
        return;
      }
      dropdown.innerHTML = matches.slice(0, MAX_SUGGESTIONS).map((city) => `
        <div class="search-suggestion-item" data-city="${city}">
          <div class="search-suggestion-name">${city}</div>
        </div>`).join('');
      dropdown.style.display = 'block';

      dropdown.querySelectorAll('.search-suggestion-item').forEach((item) => {
        item.addEventListener('click', () => {
          input.value = item.dataset.city;
          closeDropdown();
        });
      });
    }

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < MIN_CHARS) {
        closeDropdown();
        return;
      }
      const matches = CITIES.filter((c) => c.toLowerCase().includes(q));
      renderMatches(matches);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim().length >= MIN_CHARS) {
        const matches = CITIES.filter((c) => c.toLowerCase().includes(input.value.trim().toLowerCase()));
        renderMatches(matches);
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closeDropdown();
    });
  }

  function init() {
    document.querySelectorAll('.search-segment-location .search-segment-input').forEach(initLocationAutocomplete);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
