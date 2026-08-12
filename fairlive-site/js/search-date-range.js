// search-date-range.js
//
// Replaces the simple preset dropdown with a real dual-month calendar
// range picker (Start date / End date, click-to-select, Reset/Cancel/
// Apply) — matching the reference UI. Attaches to the #searchDatesBtn /
// #searchDatesPanel structure on the homepage.

(function () {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getMonthGrid(year, month) {
    const startWeekday = new Date(year, month, 1).getDay();
    const total = daysInMonth(year, month);
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= total; d++) cells.push(d);
    return cells;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toDateKey(year, month, day) {
    return `${year}-${pad2(month + 1)}-${pad2(day)}`;
  }

  function formatMMDDYYYY(year, month, day) {
    return `${pad2(month + 1)}/${pad2(day)}/${year}`;
  }

  function toISOStart(year, month, day) {
    return `${year}-${pad2(month + 1)}-${pad2(day)}T00:00:00Z`;
  }

  function toISOEnd(year, month, day) {
    return `${year}-${pad2(month + 1)}-${pad2(day)}T23:59:59Z`;
  }

  function initDateRangePicker(root) {
    const btn = root.querySelector('#searchDatesBtn');
    const panel = root.querySelector('#searchDatesPanel');
    const label = root.querySelector('#searchDatesLabel');
    const startInput = root.querySelector('#searchStartDateText');
    const endInput = root.querySelector('#searchEndDateText');
    const monthsWrap = root.querySelector('#searchCalendarMonths');
    const prevBtn = root.querySelector('#searchCalPrev');
    const nextBtn = root.querySelector('#searchCalNext');
    const resetBtn = root.querySelector('#searchCalReset');
    const cancelBtn = root.querySelector('#searchCalCancel');
    const applyBtn = root.querySelector('#searchCalApply');
    const fromHidden = root.querySelector('#searchDateFrom');
    const toHidden = root.querySelector('#searchDateTo');

    if (!btn || !panel) return;

    const today = new Date();
    const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();
    let selStart = null; // { year, month, day }
    let selEnd = null;

    function dateKeyOf(sel) { return sel ? toDateKey(sel.year, sel.month, sel.day) : null; }

    function isInRange(year, month, day) {
      if (!selStart) return false;
      const key = toDateKey(year, month, day);
      const startKey = dateKeyOf(selStart);
      const endKey = dateKeyOf(selEnd);
      if (!endKey) return key === startKey;
      return key >= startKey && key <= endKey;
    }

    function isEndpoint(year, month, day) {
      const key = toDateKey(year, month, day);
      return key === dateKeyOf(selStart) || key === dateKeyOf(selEnd);
    }

    function isPastDate(year, month, day) {
      // Comparing date keys (strings) rather than Date objects sidesteps
      // any timezone/hour subtlety — todayKey is always local midnight.
      return toDateKey(year, month, day) < todayKey;
    }

    function renderMonth(year, month) {
      const cells = getMonthGrid(year, month);
      const rows = [];
      for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
      const cellsHtml = rows.map((row) => `
        <div class="cal-week">
          ${row.map((day) => {
            if (day == null) return '<span class="cal-day cal-day-empty"></span>';
            if (isPastDate(year, month, day)) {
              return `<span class="cal-day cal-day-disabled" aria-disabled="true">${day}</span>`;
            }
            const classes = ['cal-day'];
            if (isEndpoint(year, month, day)) classes.push('cal-day-endpoint');
            else if (isInRange(year, month, day)) classes.push('cal-day-inrange');
            return `<button type="button" class="${classes.join(' ')}" data-y="${year}" data-m="${month}" data-d="${day}">${day}</button>`;
          }).join('')}
        </div>`).join('');

      return `
        <div class="cal-month">
          <div class="cal-month-title">${MONTH_NAMES[month]} ${year}</div>
          <div class="cal-weekdays">${DAY_NAMES.map((d) => `<span>${d}</span>`).join('')}</div>
          ${cellsHtml}
        </div>`;
    }

    function renderCalendar() {
      const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
      const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
      monthsWrap.innerHTML = renderMonth(viewYear, viewMonth) + renderMonth(nextYear, nextMonth);
      // Only real <button> cells are clickable — disabled past dates are
      // rendered as <span>, so this selector naturally excludes them.
      monthsWrap.querySelectorAll('button.cal-day').forEach((cell) => {
        cell.addEventListener('click', () => {
          const y = parseInt(cell.dataset.y, 10);
          const m = parseInt(cell.dataset.m, 10);
          const d = parseInt(cell.dataset.d, 10);
          handleDayClick(y, m, d);
        });
      });
      prevBtn.disabled = (viewYear === today.getFullYear() && viewMonth === today.getMonth());
    }

    function syncTextInputs() {
      startInput.value = selStart ? formatMMDDYYYY(selStart.year, selStart.month, selStart.day) : '';
      endInput.value = selEnd ? formatMMDDYYYY(selEnd.year, selEnd.month, selEnd.day) : '';
    }

    function handleDayClick(y, m, d) {
      const clicked = { year: y, month: m, day: d };
      const clickedKey = toDateKey(y, m, d);
      if (!selStart || (selStart && selEnd)) {
        // Starting a fresh selection
        selStart = clicked;
        selEnd = null;
      } else if (clickedKey < dateKeyOf(selStart)) {
        // Clicked before the current start — it becomes the new start
        selStart = clicked;
        selEnd = null;
      } else {
        selEnd = clicked;
      }
      syncTextInputs();
      renderCalendar();
    }

    function openPanel() {
      panel.style.display = 'block';
      btn.setAttribute('aria-expanded', 'true');
      renderCalendar();
    }

    function closePanel() {
      panel.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (panel.style.display === 'block') closePanel();
      else openPanel();
    });

    document.addEventListener('click', (e) => {
      // Using composedPath() instead of root.contains(e.target) matters
      // here specifically: handleDayClick() synchronously replaces the
      // calendar's innerHTML (to re-render the new selection) WHILE this
      // click event is still bubbling up to document. By the time this
      // listener runs, the clicked button has already been detached from
      // the page, so root.contains(e.target) would incorrectly return
      // false and close the panel on every single date click.
      // composedPath() captures the event's route at dispatch time, before
      // any of that DOM mutation happened, so it stays correct regardless.
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
      if (!path.includes(root)) closePanel();
    });

    prevBtn.addEventListener('click', () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      renderCalendar();
    });

    nextBtn.addEventListener('click', () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      renderCalendar();
    });

    resetBtn.addEventListener('click', () => {
      selStart = null;
      selEnd = null;
      syncTextInputs();
      renderCalendar();
    });

    cancelBtn.addEventListener('click', () => {
      closePanel();
    });

    applyBtn.addEventListener('click', () => {
      if (selStart) {
        fromHidden.value = toISOStart(selStart.year, selStart.month, selStart.day);
        toHidden.value = selEnd ? toISOEnd(selEnd.year, selEnd.month, selEnd.day) : toISOEnd(selStart.year, selStart.month, selStart.day);
        label.textContent = selEnd
          ? `${formatMMDDYYYY(selStart.year, selStart.month, selStart.day)} – ${formatMMDDYYYY(selEnd.year, selEnd.month, selEnd.day)}`
          : formatMMDDYYYY(selStart.year, selStart.month, selStart.day);
      } else {
        fromHidden.value = '';
        toHidden.value = '';
        label.textContent = 'All Dates';
      }
      closePanel();
    });
  }

  function init() {
    document.querySelectorAll('.search-form-segmented').forEach(initDateRangePicker);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
