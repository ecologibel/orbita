// ---- Shared dates ----
//
// The to-dos' @date reading, for pages that show to-dos without being
// the to-dos page (the dashboard and focus mode). Exposed as
// window.ToolkitDates.

(function () {

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"];
  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  // Month names, full or short, not followed by more letters
  const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?'
    + '|apr(?:il)?|may|june?|july?|aug(?:ust)?'
    + '|sep(?:t(?:ember)?)?|oct(?:ober)?'
    + '|nov(?:ember)?|dec(?:ember)?)(?![a-z])';

  // Weekday names, full or short, not followed by more letters
  const WEEKDAY_RE = '(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?'
    + '|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?![a-z])';

  // One date or period, without the @
  const DATE_CORE = '(?:'
    + '(?:today|tomorrow|yesterday)(?![a-z])'
    + '|(?:this|next)\\s+(?:week|month)(?![a-z])'
    + '|(?:this|last|next)\\s+' + WEEKDAY_RE
    + '|' + WEEKDAY_RE
    + '(?:\\s+\\d{1,2}\\s+' + MONTH_RE + '(?:,?\\s+\\d{4})?)?'
    + '|\\d{1,2}\\s+' + MONTH_RE + '(?:,?\\s+\\d{4})?'
    + '|' + MONTH_RE + '\\s+\\d{1,2}(?!\\d)(?:,?\\s*\\d{4})?'
    + '|\\d{4}-\\d{2}-\\d{2}'
    + '|' + MONTH_RE + '(?:\\s+\\d{4})?'
    + ')';

  // @ then a date or period, optionally "to" another one
  const DATE_PATTERN = new RegExp(
    '@' + DATE_CORE
    + '(?:\\s*(?:–|—|-|to(?![a-z]))\\s*' + DATE_CORE + ')?',
    'gi'
  );

  // Tags (#), and any word with an @ in it (names, emails, a lone @)
  const MARK_PATTERN = /(^|\s)(#[^\s#]+|[^\s#]*@[^\s]*)/g;

  function dayStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  // Monday of the week containing a day
  function weekStart(d) {
    const day = d.getDay();
    return addDays(dayStart(d), day === 0 ? -6 : 1 - day);
  }

  function monthRange(y, m) {
    return { end: new Date(y, m + 1, 0), start: new Date(y, m, 1) };
  }

  function oneDay(d) {
    return { end: d, start: d };
  }

  let legacyKeyMode = false;
  let migrationBlocked = false;

  // Calendar keys are local civil dates, independent of the time zone.
  function localDateKey(d) {
    return String(d.getFullYear()).padStart(4, "0") + "-"
      + String(d.getMonth() + 1).padStart(2, "0") + "-"
      + String(d.getDate()).padStart(2, "0");
  }

  // Older releases used UTC-derived keys; these helpers migrate that format.
  function legacyDateKey(d) {
    return d.toISOString().slice(0, 10);
  }

  function legacyKeyToDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    for (const off of [0, 1, -1]) {
      const c = new Date(y, m - 1, d + off);
      if (legacyDateKey(c) === key) return c;
    }
    return new Date(y, m - 1, d);
  }

  // Calendar keys are YYYY-MM-DD local dates.
  function dateKey(d) {
    return legacyKeyMode ? legacyDateKey(d) : localDateKey(d);
  }

  function keyToDate(key) {
    if (legacyKeyMode) return legacyKeyToDate(key);
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Convert old UTC-derived weekly keys once, keeping a local copy first.
  function migrateStoredTodoKeys() {
    if (migrationBlocked) return false;
    let raw;
    try {
      raw = localStorage.getItem("todo-data");
    } catch {
      legacyKeyMode = true;
      migrationBlocked = true;
      return false;
    }
    if (raw == null) { legacyKeyMode = false; return true; }

    let data;
    try { data = JSON.parse(raw); } catch { legacyKeyMode = false; return true; }
    if (!data || typeof data !== "object" || Array.isArray(data)
        || (data.weekly != null && (typeof data.weekly !== "object"
          || Array.isArray(data.weekly)))) {
      legacyKeyMode = false;
      return true;
    }
    if (data.dateKeyVersion >= 1) { legacyKeyMode = false; return true; }

    const weekly = data.weekly || {};
    const converted = {};
    let changed = false;
    Object.keys(weekly).forEach(key => {
      let next = key;
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        next = localDateKey(legacyKeyToDate(key));
        if (next !== key) changed = true;
      }
      const list = weekly[key];
      if (Object.prototype.hasOwnProperty.call(converted, next)
          && Array.isArray(converted[next]) && Array.isArray(list)) {
        converted[next].push(...list);
      } else {
        converted[next] = list;
      }
    });

    if (changed) {
      try {
        const backupKey = "todo-date-key-backup-v1";
        const previous = localStorage.getItem(backupKey);
        if (previous == null) localStorage.setItem(backupKey, raw);
        else if (previous !== raw) {
          localStorage.setItem(backupKey + "-" + Date.now(), raw);
        }
      } catch {
        legacyKeyMode = true;
        migrationBlocked = true;
        return false;
      }
    }

    data.weekly = converted;
    data.dateKeyVersion = 1;
    try {
      localStorage.setItem("todo-data", JSON.stringify(data));
      legacyKeyMode = false;
      return true;
    } catch {
      legacyKeyMode = true;
      migrationBlocked = true;
      return false;
    }
  }

  // A single date or period as a day range, relative to an anchor day
  function parseOne(str, anchor) {
    const s = str.trim().toLowerCase().replace(/\s+/g, " ");
    const mon = name => MONTHS.indexOf(name.slice(0, 3));
    let m;

    if (s === "today") return oneDay(anchor);
    if (s === "tomorrow") return oneDay(addDays(anchor, 1));
    if (s === "yesterday") return oneDay(addDays(anchor, -1));
    if ((m = s.match(/^(this|next) (week|month)$/))) {
      const next = m[1] === "next";
      if (m[2] === "week") {
        const start = addDays(weekStart(anchor), next ? 7 : 0);
        return { end: addDays(start, 6), start };
      }
      return monthRange(
        anchor.getFullYear(), anchor.getMonth() + (next ? 1 : 0)
      );
    }
    if ((m = s.match(new RegExp(
      '^((?:this|last|next) )?' + WEEKDAY_RE + '$'
    )))) {
      const qualifier = m[1] || "";
      const name = s.replace(/^(this|last|next) /, "").slice(0, 3);
      const wd = WEEKDAYS.indexOf(name);
      const coming = (wd - anchor.getDay() + 7) % 7;
      if (qualifier === "last") {
        const previous = (anchor.getDay() - wd + 7) % 7 || 7;
        return oneDay(addDays(anchor, -previous));
      }
      return oneDay(addDays(anchor, coming + (qualifier === "next" ? 7 : 0)));
    }

    let weekday = null;
    let dateText = s;
    const weekdayDate = s.match(new RegExp('^(' + WEEKDAY_RE + ') (.+)$'));
    if (weekdayDate) {
      weekday = WEEKDAYS.indexOf(weekdayDate[1].slice(0, 3));
      dateText = weekdayDate[2];
    }

    let day, month, year;
    if ((m = dateText.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/))) {
      [year, month, day] = [m[1], +m[2] - 1, +m[3]];
    } else if ((m = dateText.match(new RegExp(
      '^(\\d{1,2}) ' + MONTH_RE + '(?:,? (\\d{4}))?$'
    )))) {
      [day, month, year] = [+m[1], mon(m[2]), m[3]];
    } else if ((m = dateText.match(new RegExp(
      '^' + MONTH_RE + ' (\\d{1,2})(?:,? ?(\\d{4}))?$'
    )))) {
      [day, month, year] = [+m[2], mon(m[1]), m[3]];
    } else if ((m = dateText.match(new RegExp('^' + MONTH_RE + '(?: (\\d{4}))?$')))) {
      const y = m[2] ? +m[2] : anchor.getFullYear();
      let r = monthRange(y, mon(m[1]));
      if (!m[2] && r.end < anchor) r = monthRange(y + 1, mon(m[1]));
      return r;
    } else {
      return null;
    }
    let y = year ? +year : anchor.getFullYear();
    if (y < 100) y += 2000;
    let d = new Date(y, month, day);
    if (d.getMonth() !== month || d.getDate() !== day) return null;
    if (!year && d < addDays(anchor, -31)) d = new Date(y + 1, month, day);
    if (weekday !== null && d.getDay() !== weekday) return null;
    return oneDay(d);
  }

  // Parse one day with the same grammar used for task dates.
  function parseDay(str, anchor) {
    const parsed = parseOne(String(str || "").replace(/^@/, ""), dayStart(anchor));
    return parsed && parsed.start.getTime() === parsed.end.getTime()
      ? parsed.start : null;
  }

  // A date, period, or "A to B" range as a day range
  function parseSpec(str, anchor) {
    const one = parseOne(str, anchor);
    if (one) return one;
    const join = (left, right) => {
      const a = parseOne(left, anchor), b = parseOne(right, anchor);
      return !a || !b || b.end < a.start
        ? null : { end: b.end, start: a.start };
    };
    const named = str.split(/\s*(?:–|—|\bto\b)\s*/i);
    if (named.length === 2) {
      const range = join(named[0], named[1]);
      if (range) return range;
    }
    for (let i = 0; i < str.length; i++) {
      if (str[i] !== "-") continue;
      const range = join(str.slice(0, i), str.slice(i + 1));
      if (range) return range;
    }
    return null;
  }

  function firstToken(text) {
    DATE_PATTERN.lastIndex = 0;
    const m = DATE_PATTERN.exec(text || "");
    return m ? m[0].toLowerCase() : "";
  }

  // The first date in some text that resolves, as a day range
  function textRange(text, anchor) {
    DATE_PATTERN.lastIndex = 0;
    let m;
    while ((m = DATE_PATTERN.exec(text || ""))) {
      const r = parseSpec(m[0].slice(1), anchor);
      if (r) return r;
    }
    return null;
  }

  // A task's date: from its text, else from the calendar cell it is in
  function taskRange(task, listKey) {
    const anchor = dayStart(
      task.anchorAt ? new Date(task.anchorAt) : new Date()
    );
    const r = textRange(task.text, anchor);
    if (r) return r;
    if (listKey && /^\d{4}-\d{2}-\d{2}$/.test(listKey)) {
      return oneDay(keyToDate(listKey));
    }
    if (listKey && listKey.startsWith("_ym-")) {
      const [, y, mm] = listKey.split("-");
      return monthRange(+y, +mm);
    }
    return null;
  }

  // Note when a task's date was written, so relative dates stay put
  function stampAnchor(task) {
    const tok = firstToken(task.text);
    if (tok !== task.anchorTok || !task.anchorAt) {
      task.anchorTok = tok;
      task.anchorAt = Date.now();
    }
  }

  function datePattern() {
    return new RegExp(DATE_PATTERN.source, DATE_PATTERN.flags);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function dateAnchorValue(anchor) {
    const value = anchor instanceof Date ? anchor.getTime() : Number(anchor);
    return Number.isFinite(value) ? String(value) : "";
  }

  function setDateTokenAttributes(span, text, start, anchor) {
    span.classList.add("date-token");
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    span.title = "Click to confirm or change date";
    span.setAttribute("aria-label", "Choose date for " + text);
    span.dataset.dateStart = String(start);
    span.dataset.dateEnd = String(start + text.length);
    const anchorValue = dateAnchorValue(anchor);
    if (anchorValue) span.dataset.dateAnchor = anchorValue;
  }

  function dateTokenHtml(text, start, anchor) {
    const span = document.createElement("span");
    setDateTokenAttributes(span, text, start, anchor);
    span.textContent = text;
    return '<span class="date-token" role="button" tabindex="0" '
      + 'title="Click to confirm or change date" '
      + 'aria-label="' + escapeHtml("Choose date for " + text) + '" '
      + 'data-date-start="' + start + '" data-date-end="'
      + (start + text.length) + '"'
      + (dateAnchorValue(anchor)
        ? ' data-date-anchor="' + dateAnchorValue(anchor) + '"' : "")
      + '>' + escapeHtml(text) + '</span>';
  }

  function replaceTextRange(text, start, end, replacement) {
    const value = String(text || "");
    start = Number(start);
    end = Number(end);
    if (!Number.isInteger(start) || !Number.isInteger(end)
        || start < 0 || end < start || end > value.length) return value;
    return value.slice(0, start) + replacement + value.slice(end);
  }

  // Replace a range in HTML using offsets from its visible, trimmed text.
  function replaceHtmlRange(html, start, end, replacement) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const points = [];
    let visible = "";
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        points.push({ node, start: visible.length, end: visible.length + node.data.length });
        visible += node.data;
      } else if (node.nodeType === Node.ELEMENT_NODE
          && node.tagName === "BR") {
        visible += " ";
      }
    }
    const leading = visible.length - visible.trimStart().length;
    start = Number(start) + leading;
    end = Number(end) + leading;
    const pointAt = pos => {
      for (const point of points) {
        if (pos >= point.start && pos <= point.end) {
          return [point.node, pos - point.start];
        }
      }
      return null;
    };
    const a = pointAt(start), z = pointAt(end);
    if (!a || !z) return null;
    const range = document.createRange();
    range.setStart(a[0], a[1]);
    range.setEnd(z[0], z[1]);
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    return template.innerHTML;
  }

  function ensureDatePickerStyles() {
    if (document.getElementById("orbita-date-picker-style")) return;
    const style = document.createElement("style");
    style.id = "orbita-date-picker-style";
    style.textContent = `
      .date-token { cursor: pointer; text-decoration: underline dotted;
        text-underline-offset: 2px; }
      .date-token:focus-visible { border-radius: 2px;
        outline: 2px solid var(--accent, #7fdbca); outline-offset: 2px; }
      .orbita-date-picker {
        background: #01111f; border: 1px solid #1e3a52; border-radius: 8px;
        box-shadow: 0 8px 28px rgba(0,0,0,.32); color: #d6deeb;
        font: 13px/1.4 'Segoe UI', sans-serif; padding: 12px;
        position: fixed; width: 284px; z-index: 10000;
      }
      .orbita-date-picker[hidden] { display: none; }
      .orbita-date-picker .date-field-row { align-items: center;
        display: flex; gap: 6px; margin-bottom: 10px; }
      .orbita-date-picker input.date-input {
        background: #011627; border: 1px solid #1e3a52; border-radius: 4px;
        color: #d6deeb; flex: 1; font: 15px/1.3 'Segoe UI', sans-serif;
        min-height: 34px; min-width: 0; padding: 5px 8px; width: 0;
      }
      .orbita-date-picker .today-button {
        border: 1px solid #426078; color: #7fdbca; flex: 0 0 auto;
        font-size: 12px; min-height: 30px; padding: 3px 8px;
      }
      .orbita-date-picker .date-error { color: #f78c6c; font-size: 11px;
        margin: -5px 0 8px; }
      .orbita-date-picker .date-error:empty { display: none; }
      .orbita-date-picker .calendar-head { align-items: center; display: flex;
        justify-content: space-between; margin: 2px 0 8px; }
      .orbita-date-picker .month-name { font-size: 13px; font-weight: 600; }
      .orbita-date-picker button {
        align-items: center; background: transparent; border: 0;
        border-radius: 4px; color: inherit; cursor: pointer; display: inline-flex;
        font: inherit; justify-content: center; min-height: 28px; min-width: 28px;
      }
      .orbita-date-picker button:hover,
      .orbita-date-picker button:focus-visible { background: rgba(127,219,202,.14);
        outline: none; }
      .orbita-date-picker .calendar-nav { color: #8291a5; font-size: 18px; }
      .orbita-date-picker .calendar-grid { display: grid;
        grid-template-columns: repeat(7, 1fr); gap: 2px; }
      .orbita-date-picker .weekday { color: #8291a5; font-size: 10px;
        text-align: center; padding: 4px 0; }
      .orbita-date-picker .day { min-height: 30px; padding: 0; }
      .orbita-date-picker .day.outside { color: #586779; }
      .orbita-date-picker .day.today { box-shadow: inset 0 0 0 1px #7fdbca; }
      .orbita-date-picker .day.selected,
      .orbita-date-picker .day.in-range {
        background: #7fdbca; color: #011627; font-weight: 600;
      }
      .orbita-date-picker .date-actions { display: flex; gap: 6px;
        justify-content: flex-end; margin-top: 10px; }
      .orbita-date-picker .date-actions button { padding: 4px 9px; }
      .orbita-date-picker .date-actions .primary {
        background: #7fdbca; color: #011627; font-weight: 600;
      }
      :where(.t-light) .orbita-date-picker {
        background: #fff; border-color: #d7e0e8; color: #233044;
        box-shadow: 0 8px 28px rgba(20,40,60,.18);
      }
      :where(.t-light) .orbita-date-picker input.date-input {
        background: #fff; border-color: #d7e0e8; color: #233044;
      }
      :where(.t-light) .orbita-date-picker .today-button {
        border-color: #d7e0e8; color: #147d70;
      }
      :where(.t-light) .orbita-date-picker .day.selected,
      :where(.t-light) .orbita-date-picker .day.in-range {
        background: #147d70; color: #fff;
      }
      :where(.t-light) .orbita-date-picker .day.today {
        box-shadow: inset 0 0 0 1px #147d70;
      }
    `;
    document.head.appendChild(style);
  }

  function pickerDate(value) {
    if (value instanceof Date) return dayStart(value);
    const m = String(value || "").match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1
      && d.getDate() === +m[3] ? d : null;
  }

  function showDatePicker(start, end, rangeMode, onChange, origin, anchor) {
    const from = pickerDate(start), to = pickerDate(end);
    if (!from || !to || typeof onChange !== "function") return false;
    ensureDatePickerStyles();

    const popup = document.createElement("section");
    popup.className = "orbita-date-picker";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", rangeMode ? "Choose date range" : "Choose date");
    const fieldRow = document.createElement("div");
    fieldRow.className = "date-field-row";
    const dateInput = document.createElement("input");
    dateInput.type = "text";
    dateInput.className = "date-input";
    dateInput.setAttribute("aria-label", "Type a date");
    dateInput.placeholder = "e.g. 6 nov or next fri";
    const todayButton = document.createElement("button");
    todayButton.type = "button";
    todayButton.className = "today-button";
    todayButton.textContent = "today";
    fieldRow.append(dateInput, todayButton);
    const error = document.createElement("div");
    error.className = "date-error";
    error.setAttribute("role", "status");
    let selectedStart = from, selectedEnd = to;
    let activeEdge = "start";
    let shownMonth = new Date(from.getFullYear(), from.getMonth(), 1);
    const writeField = () => {
      const first = localDateKey(selectedStart);
      const last = localDateKey(selectedEnd);
      dateInput.value = rangeMode && first !== last
        ? first + " to " + last : first;
      error.textContent = "";
    };
    writeField();

    const head = document.createElement("div");
    head.className = "calendar-head";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "calendar-nav";
    prev.setAttribute("aria-label", "previous month");
    prev.textContent = "‹";
    const monthName = document.createElement("strong");
    monthName.className = "month-name";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "calendar-nav";
    next.setAttribute("aria-label", "next month");
    next.textContent = "›";
    head.append(prev, monthName, next);
    const grid = document.createElement("div");
    grid.className = "calendar-grid";
    grid.setAttribute("role", "grid");
    const actions = document.createElement("div");
    actions.className = "date-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "cancel";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "primary";
    apply.textContent = "apply";
    if (rangeMode) actions.append(cancel, apply);

    const close = () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      popup.remove();
      if (origin && origin.isConnected) origin.focus({ preventScroll: true });
    };
    const outside = e => {
      if (!popup.contains(e.target) && e.target !== origin) close();
    };
    const escape = e => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const position = () => {
      if (!origin || !origin.isConnected) return;
      const rect = origin.getBoundingClientRect();
      const bounds = popup.getBoundingClientRect();
      const gap = 6;
      const left = Math.max(8, Math.min(rect.left,
        window.innerWidth - bounds.width - 8));
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const top = below >= bounds.height || below >= above
        ? Math.min(rect.bottom + gap, window.innerHeight - bounds.height - 8)
        : Math.max(8, rect.top - bounds.height - gap);
      popup.style.left = left + "px";
      popup.style.top = top + "px";
    };
    const applyRange = () => {
      if (selectedEnd < selectedStart) {
        error.textContent = "Choose an end date on or after the start date.";
        return false;
      }
      onChange("@" + localDateKey(selectedStart)
        + (localDateKey(selectedEnd) !== localDateKey(selectedStart)
          ? " to " + localDateKey(selectedEnd) : ""));
      close();
      return true;
    };
    const acceptTyped = () => {
      const raw = dateInput.value.trim().replace(/^@/, "");
      const parsed = parseSpec(raw, dayStart(anchor || new Date()));
      if (!parsed) {
        error.textContent = "Enter a recognised date, such as 6 nov or next fri.";
        return false;
      }
      selectedStart = parsed.start;
      selectedEnd = parsed.end;
      shownMonth = new Date(parsed.start.getFullYear(), parsed.start.getMonth(), 1);
      writeField();
      renderCalendar();
      if (!rangeMode) {
        applyRange();
      }
      return true;
    };
    const renderCalendar = () => {
      monthName.textContent = shownMonth.toLocaleDateString(undefined,
        { month: "long", year: "numeric" });
      grid.replaceChildren();
      ["M", "T", "W", "T", "F", "S", "S"].forEach((day, i) => {
        const label = document.createElement("span");
        label.className = "weekday";
        label.setAttribute("role", "columnheader");
        label.textContent = day;
        label.setAttribute("aria-label",
          ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]);
        grid.appendChild(label);
      });
      const first = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), 1);
      const offset = (first.getDay() + 6) % 7;
      const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
      const startKey = localDateKey(selectedStart);
      const endKey = localDateKey(selectedEnd);
      const todayKey = localDateKey(dayStart(new Date()));
      for (let i = 0; i < 42; i++) {
        const d = addDays(gridStart, i), key = localDateKey(d);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "day";
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", d.toLocaleDateString(undefined,
          { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
        button.textContent = String(d.getDate());
        if (d.getMonth() !== shownMonth.getMonth()) button.classList.add("outside");
        if (key === todayKey) button.classList.add("today");
        if (key === startKey || key === endKey) button.classList.add("selected");
        if (endKey !== startKey && key > startKey && key < endKey) {
          button.classList.add("in-range");
        }
        button.addEventListener("click", () => {
          if (!rangeMode) {
            selectedStart = selectedEnd = d;
            onChange("@" + key);
            close();
            return;
          }
          if (activeEdge === "start") {
            selectedStart = d;
            if (selectedEnd < selectedStart) selectedEnd = selectedStart;
            activeEdge = "end";
          } else {
            selectedEnd = d;
            activeEdge = "start";
          }
          writeField();
          renderCalendar();
        });
        grid.appendChild(button);
      }
      position();
    };
    prev.addEventListener("click", () => {
      shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    next.addEventListener("click", () => {
      shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    dateInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        acceptTyped();
      }
    });
    dateInput.addEventListener("input", () => { error.textContent = ""; });
    todayButton.addEventListener("click", () => {
      const today = dayStart(new Date());
      if (!rangeMode) {
        onChange("@" + localDateKey(today));
        close();
        return;
      }
      if (activeEdge === "start") {
        selectedStart = today;
        if (selectedEnd < selectedStart) selectedEnd = selectedStart;
        activeEdge = "end";
      } else {
        selectedEnd = today;
        activeEdge = "start";
      }
      shownMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      writeField();
      renderCalendar();
    });
    if (rangeMode) {
      cancel.addEventListener("click", close);
      apply.addEventListener("click", applyRange);
    }
    popup.append(fieldRow, error, head, grid, actions);
    document.body.appendChild(popup);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    renderCalendar();
    dateInput.focus({ preventScroll: true });
    return true;
  }

  function openDatePicker(token, onChange) {
    const anchorValue = Number(token && token.dataset.dateAnchor);
    const anchor = Number.isFinite(anchorValue)
      ? dayStart(new Date(anchorValue)) : dayStart(new Date());
    const range = parseSpec(String(token && token.textContent || "").replace(/^@/, ""), anchor);
    if (!range) return false;
    return showDatePicker(range.start, range.end,
      range.start.getTime() !== range.end.getTime(), onChange, token, anchor);
  }

  function openDatePickerValue(value, onChange, origin) {
    const date = pickerDate(value);
    return date ? showDatePicker(date, date, false,
      iso => onChange(iso.slice(1)), origin, dayStart(new Date())) : false;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", e => {
      const token = e.target && e.target.closest
        ? e.target.closest(".date-token[role='button']") : null;
      if (!token || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      token.click();
    });
    document.addEventListener("click", e => {
      const token = e.target && e.target.closest
        ? e.target.closest(".date-token[role='button']") : null;
      if (!token) return;
      const editor = token.closest("[contenteditable='true'], [contenteditable='plaintext-only']");
      if (!editor) return;
      e.preventDefault();
      e.stopPropagation();
      openDatePicker(token, replacement => {
        token.replaceWith(document.createTextNode(replacement));
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: replacement }));
      });
    });
  }
  function highlightTags(seg) {
    let out = "", last = 0, m;
    MARK_PATTERN.lastIndex = 0;
    while ((m = MARK_PATTERN.exec(seg))) {
      const start = m.index + m[1].length;
      const isTag = m[2][0] === "#";
      const mark = m[2].replace(/[.,;:!?)\]]+$/, "") || m[2];
      if (isTag && mark.length < 2) continue;
      out += escapeHtml(seg.slice(last, start)) + '<span class="'
        + (isTag ? "tag-token" : "mention-token") + '">'
        + escapeHtml(mark) + "</span>";
      last = start + mark.length;
    }
    return out + escapeHtml(seg.slice(last));
  }

  // Task text as html with dates, tags and names coloured
  function highlight(text, anchor) {
    let out = "", last = 0, m;
    DATE_PATTERN.lastIndex = 0;
    while ((m = DATE_PATTERN.exec(text || ""))) {
      out += highlightTags(text.slice(last, m.index))
        + dateTokenHtml(m[0], m.index, anchor);
      last = m.index + m[0].length;
    }
    return out + highlightTags((text || "").slice(last));
  }

  // A note's html with @dates and #tags wrapped in coloured spans, as
  // the notes show them; code and links are left alone
  const TAG_PATTERN = /(^|\s)(#[^\s#]+)/g;
  function decorate(html, anchor) {
    if (!/[@#]/.test(html)) return html;
    const t = document.createElement("template");
    t.innerHTML = html;
    const nodes = [];
    let visibleOffset = 0;
    const walker = document.createTreeWalker(t.content, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE) {
        const p = node.parentElement;
        if (!p || !p.closest("code, a")) nodes.push({ node, offset: visibleOffset });
        visibleOffset += node.data.length;
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
        visibleOffset += 1;
      }
    }
    nodes.forEach(({ node, offset }) => {
      const text = node.data, marks = [];
      let m;
      DATE_PATTERN.lastIndex = 0;
      while ((m = DATE_PATTERN.exec(text))) {
        marks.push([m.index, m.index + m[0].length, "date-token", true, offset]);
      }
      TAG_PATTERN.lastIndex = 0;
      while ((m = TAG_PATTERN.exec(text))) {
        const tag = m[2].replace(/[.,;:!?)\]]+$/, "");
        const start = m.index + m[1].length, end = start + tag.length;
        if (tag.length > 1 && !marks.some(x => start < x[1] && end > x[0])) {
          marks.push([start, end, "tag-token", false, offset]);
        }
      }
      if (!marks.length) return;
      marks.sort((a, b) => a[0] - b[0]);
      const frag = document.createDocumentFragment();
      let last = 0;
      marks.forEach(([a, z, cls, isDate, offset]) => {
        if (a < last) return;
        if (a > last) {
          frag.appendChild(document.createTextNode(text.slice(last, a)));
        }
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = text.slice(a, z);
        if (isDate) setDateTokenAttributes(span, text.slice(a, z), offset + a, anchor);
        frag.appendChild(span);
        last = z;
      });
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
      }
      node.replaceWith(frag);
    });
    return t.innerHTML;
  }

  window.ToolkitDates = {
    addDays, dateKey, datePattern, dateTokenHtml, dayStart, decorate,
    firstToken, highlight, keyToDate, migrateStoredTodoKeys, monthRange, oneDay,
    openDatePicker, openDatePickerValue, parseDay, parseSpec,
    replaceHtmlRange, replaceTextRange, stampAnchor, taskRange, textRange,
    weekStart
  };

})();
