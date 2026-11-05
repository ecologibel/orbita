// ---- Toolkit sidebar ----
//
// A narrow navigation bar on the left of every page: the toolkit's views
// as icons, with mode, size and width controls at the bottom. Mode is
// shared by every page; each page supplies its own size and width.
//
// Usage:
//   ToolkitSidebar.init({
//     active: "dates",
//     onView: id => { ...; return true; },  // in-page views; else a link
//     mode:  { initial: "dark", apply: (mode, animate) => {} },
//     size:  { get: () => "m", set: v => {} },
//     width: { get: () => "normal", set: v => {} }
//   });
//
// sync.js reports its state through ToolkitSidebar.setSync, which shows
// the sync icon at the bottom of the bar.
//
// Also shared by every page: the tab icon, tab titles (title), a quick
// switcher on Ctrl+K, and an undo toast (toast).
//
// Focus mode's timer runs here too (window.ToolkitFocus), so it keeps
// counting on every page: a chip shows the time left, and at 0 a banner
// slides down and a chime plays. The focus page itself calls init with
// bare: true, which skips the bar. The focus page passes focusPage: true
// instead: it gets the bar (shown only while picking a task) but no focus
// chip, and isn't remembered as the last page.

(function () {

  const LAST_KEY  = "toolkit-last";
  const MODE_KEY  = "toolkit-mode";
  const VIEW_KEY  = "toolkit-todos-view";
  const SHARED    = { size: "toolkit-size", width: "toolkit-width" };
  const TODO_VIEWS = ["simple", "dates", "weekly", "month", "year", "done"];

  // Shared stroke icons, drawn on a 24-unit grid
  const svg = inner => '<svg viewBox="0 0 24 24" width="22" height="22" '
    + 'fill="none" stroke="currentColor" stroke-width="1.8" '
    + 'stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  const dot = (x, y) => '<circle cx="' + x + '" cy="' + y
    + '" r="1.3" fill="currentColor" stroke="none"/>';

  // Secondary strokes in each icon are dimmed
  const dim = inner => '<g opacity="0.4">' + inner + '</g>';

  const ITEMS = [
    {
      id: "notes", label: "notes", page: "notes/index.html",
      icon: svg('<path d="M14.5 3h-8A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 '
        + '6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-12z"/>'
        + '<path d="M14.5 3v4.5H19"/>'
        + dim('<path d="M8.5 12.5h7M8.5 16.5h5"/>'))
    },
    {
      id: "todos", label: "to dos",
      icon: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/>'
        + dim('<path d="M8 12.3l2.8 2.8 5.4-5.6"/>'))
    },
    {
      id: "simple", label: "simple",
      icon: svg('<path d="M4.5 6h15M4.5 12h15M4.5 18h15"/>')
    },
    {
      id: "dates", label: "dates",
      icon: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="2"/>'
        + '<path d="M3 9.5h18M8 2.5v4M16 2.5v4M7 13.5h4M7 17h7"/>')
    },
    {
      id: "weekly", label: "week",
      icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/>'
        + '<path d="M9 4v16M15 4v16"/>')
    },
    {
      id: "month", label: "month",
      icon: svg('<rect x="3" y="4.5" width="18" height="16.5" rx="2"/>'
        + '<path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'
        + dot(7.5, 13.5) + dot(12, 13.5) + dot(16.5, 13.5)
        + dot(7.5, 17.3) + dot(12, 17.3) + dot(16.5, 17.3))
    },
    {
      id: "year", label: "year",
      icon: svg([3.5, 10, 16.5].map(x => [3.5, 10, 16.5].map(y =>
        '<rect x="' + x + '" y="' + y + '" width="4" height="4" rx="1"/>')
        .join("")).join(""))
    },
    {
      id: "done", label: "done",
      icon: svg('<circle cx="12" cy="12" r="9"/>'
        + '<path d="M8 12.5l2.7 2.7L16 9.5"/>')
    },
    {
      id: "codepad", label: "codepad", page: "codepad/index.html",
      icon: svg('<path d="M8.5 7l-5 5 5 5M15.5 7l5 5-5 5"/>'
        + dim('<path d="M13.5 4.5l-3 15"/>'))
    },
    {
      // A timer ring, partly run down
      id: "focus", label: "focus", page: "focus/index.html",
      icon: svg(dim('<circle cx="12" cy="12" r="8.5"/>')
        + '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/>')
    },
    {
      id: "timekeeper", label: "timekeeper", page: "timekeeper/index.html",
      icon: svg('<circle cx="12" cy="12" r="9"/>'
        + dim('<path d="M12 7v5l3.5 2"/>'))
    },
    {
      id: "help", label: "help", page: "help/index.html",
      icon: svg('<circle cx="12" cy="12" r="9"/>'
        + '<path d="M9.7 9a2.4 2.4 0 1 1 3.8 1.9c-1 .7-1.5 1.1-1.5 2.6"/>'
        + '<circle cx="12" cy="17.2" r=".7" fill="currentColor" stroke="none"/>')
    }
  ];

  // Simple icons a notes folder can wear
  const FOLDER_ICONS = {
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 '
      + '21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 '
      + '1-5.8-4.2-4.1 5.8-.8z"/>',
    book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 '
      + '5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5zM12 6.5v13"/>',
    flask: '<path d="M9.5 3.5h5M10.5 3.5v6L5 18.5a1.5 1.5 0 0 0 1.3 2h11.4'
      + 'a1.5 1.5 0 0 0 1.3-2L13.5 9.5v-6M7.6 14.5h8.8"/>',
    leaf: '<path d="M5 19c0-8 5-13.5 14.5-14C19.5 14 14.5 19 6 19zM5 19'
      + 'l8.5-8.5"/>',
    bird: '<path d="M14 7.5a3 3 0 0 1 5.6-1.4l1.9.4-1.8 1.2c.2 5.6-3.9 '
      + '10.3-10 10.3H3.5l3.6-3c-2.1-1.4-3-4.1-2.6-6.8 2.3 2.6 5.7 4 '
      + '9.5 3.6z"/>',
    paw: dot(7, 10).replace('r="1.3"', 'r="1.7"')
      + dot(10.4, 6.6).replace('r="1.3"', 'r="1.7"')
      + dot(13.6, 6.6).replace('r="1.3"', 'r="1.7"')
      + dot(17, 10).replace('r="1.3"', 'r="1.7"')
      + '<path d="M12 12.5c-3 0-5.5 3.5-5.5 5.5 0 1.5 1.5 2.5 3 2l2.5-.8 '
      + '2.5.8c1.5.5 3-.5 3-2 0-2-2.5-5.5-5.5-5.5z"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 '
      + '11z"/><circle cx="12" cy="10" r="2.3"/>',
    camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1'
      + 'H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.3" '
      + 'r="3.4"/>',
    chart: '<path d="M4 4v16h16M8.5 16v-4M12.5 16V8M16.5 16v-6"/>',
    code: '<path d="M8.5 7l-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/>'
      + '<path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    mortarboard: '<path d="M2.5 9L12 4.5 21.5 9 12 13.5zM6.5 11v5c3 2.5 '
      + '8 2.5 11 0v-5M21.5 9v5"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/>'
      + '<path d="M9 7.5V5.5h6v2M3.5 12.5h17"/>',
    heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 '
      + '0 1 19.5 10c0 5.5-7.5 10-7.5 10z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3.5a6 6 0 0 0-3.5 10.9V16h7v-1.6'
      + 'A6 6 0 0 0 12 3.5z"/>'
  };

  function folderIcon(name) {
    return svg(FOLDER_ICONS[name] || FOLDER_ICONS.folder);
  }

  const MODE_ICON = {
    // A full-bodied crescent, its hollow cut from the upper right
    dark: svg('<path d="M12.3 3.6A8.6 8.6 0 1 0 20.6 14.2 7.4 7.4 0 0 1 '
      + '12.3 3.6z"/>'),
    light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2'
      + 'M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18'
      + 'M18 6l1.4-1.4"/>')
  };

  // Two circling arrows, crossed out when sync can't run here
  const syncIcon = off => svg('<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1'
    + 'M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.8 3v4h-4M6.2 21v-4h4"/>'
    + (off ? '<path d="M4 4l16 16"/>' : ''));

  // A letter that grows with the size setting
  const sizeIcon = v => svg('<text x="12" y="18" text-anchor="middle" '
    + 'font-size="' + { s: 11, m: 15, l: 20 }[v] + '" font-weight="600" '
    + 'fill="currentColor" stroke="none" font-family="Segoe UI, sans-serif">'
    + 'A</text>');

  // A page between two edges, wider for each width setting
  const widthIcon = v => {
    const [a, b] = { normal: [9, 15], wide: [6.5, 17.5], full: [4.5, 19.5] }[v];
    return svg(dim('<path d="M2.5 5v14M21.5 5v14"/>')
      + '<rect x="' + a + '" y="7" width="' + (b - a) + '" height="10" rx="1.5"/>');
  };

  const CYCLE = {
    mode: ["dark", "light"],
    size: ["s", "m", "l"],
    width: ["normal", "wide", "full"]
  };
  const NAMES = { s: "small", m: "medium", l: "large" };
  const VIEW_NAMES = { dates: "dates", done: "done", month: "month",
    simple: "simple", weekly: "week", year: "year" };
  const LAYERS = '<path d="M7 3.1a9.5 9.5 0 1 1-4 4.8" '
    + 'fill="none" stroke="currentColor" stroke-width="1.8" '
    + 'stroke-linecap="round"/>'
    + '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>'
    + '<circle cx="5.2" cy="4.7" r="1.8" fill="currentColor" stroke="none"/>';

  let cfg = null, nav = null, mode = "dark", syncState = null;
  let tip = null, tipFor = null;

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  function read(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function addStyles() {
    const style = document.createElement("style");
    style.textContent = `
      body.has-sidebar { padding-left: 60px; }
      #tk-sidebar {
        align-items: center;
        background: #01111f;
        border-right: 1px solid #1e3a52;
        bottom: 0;
        display: flex;
        flex-direction: column;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        left: 0;
        overflow-x: hidden;
        overflow-y: auto;
        padding: 12px 0;
        position: fixed;
        scrollbar-width: none;
        top: 0;
        width: 60px;
        z-index: 900;
      }
      #tk-sidebar::-webkit-scrollbar { display: none; }
      #tk-sidebar .tk-home {
        align-items: center;
        border-radius: 8px;
        color: #6c7a89;
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 4px 6px 2px;
        text-decoration: none;
        transition: color 0.15s;
      }
      #tk-sidebar .tk-home svg { color: #7fdbca; }
      #tk-sidebar .tk-home:hover .tk-title { color: #ffffff; }
      #tk-sidebar .tk-home.active .tk-title { color: #7fdbca; }
      #tk-sidebar .tk-home:focus-visible { outline: 2px solid #7fdbca; }
      #tk-sidebar .tk-title {
        transition: color 0.15s;
        color: #d6deeb;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: lowercase;
      }
      #tk-sidebar .tk-rule {
        border: none;
        border-top: 1px solid #1e3a52;
        margin: 10px 0 8px;
        width: 36px;
      }
      #tk-sidebar .tk-group {
        align-items: center;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #tk-sidebar .tk-controls { margin-top: auto; padding-top: 8px; }
      #tk-sidebar .tk-btn {
        align-items: center;
        background: none;
        border: none;
        border-radius: 8px;
        color: #6c7a89;
        cursor: pointer;
        display: flex;
        height: 40px;
        justify-content: center;
        position: relative;
        text-decoration: none;
        transition: background 0.15s, color 0.15s;
        width: 40px;
        flex-shrink: 0;
      }
      #tk-sidebar .tk-btn:hover { background: #012a3f; color: #d6deeb; }
      #tk-sidebar .tk-btn.active { background: #012a3f; color: #7fdbca; }
      #tk-sidebar .tk-btn.active::before {
        background: #7fdbca;
        border-radius: 0 2px 2px 0;
        content: '';
        height: 20px;
        left: -10px;
        position: absolute;
        width: 3px;
      }
      #tk-sidebar .tk-btn:focus-visible { outline: 2px solid #7fdbca; }

      /* The to-dos views slide open below their icon, on a lighter band */
      #tk-sidebar .tk-sub {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.25s ease;
        width: 60px;
      }
      #tk-sidebar .tk-sub.open { grid-template-rows: 1fr; }
      #tk-sidebar .tk-sub-inner {
        align-items: center;
        background: #041d2e;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-height: 0;
        overflow: hidden;
        padding: 0;
        transition: padding 0.25s ease;
      }
      #tk-sidebar .tk-sub.open .tk-sub-inner { padding: 4px 0; }
      #tk-sidebar .tk-sub .tk-btn { height: 34px; width: 36px; }
      #tk-sidebar .tk-sub .tk-btn svg { height: 19px; width: 19px; }
      #tk-sidebar .tk-sub .tk-btn.active::before { left: -12px; }
      #tk-sidebar .tk-btn[data-id="todos"] .tk-chev {
        bottom: 3px;
        position: absolute;
        right: 3px;
        transition: transform 0.25s ease;
      }
      #tk-sidebar .tk-btn[data-id="todos"].open .tk-chev {
        transform: rotate(180deg);
      }
      #tk-sidebar .tk-btn.has-active { color: #7fdbca; }

      /* Sync icon: teal while sync runs, orange when it isn't running
         (signed out or failed), yellow for a conflict */
      /* The sidebar icon is the only sync control */
      #tool-sync { display: none !important; }
      #tk-sidebar #tk-sync[hidden] { display: none; }
      #tk-sidebar #tk-ambience[hidden] { display: none; }
      #tk-sidebar #tk-ambience { color: #7fdbca; }
      #tk-sidebar #tk-sync[data-state="pending"],
      #tk-sidebar #tk-sync[data-state="synced"],
      #tk-sidebar #tk-sync[data-state="syncing"] { color: #7fdbca; }
      #tk-sidebar #tk-sync[data-state="signedOut"],
      #tk-sidebar #tk-sync[data-state="reconnect"],
      #tk-sidebar #tk-sync[data-state="error"] { color: #ff9a3c; }
      #tk-sidebar #tk-sync[data-state="conflict"] { color: #f5d547; }
      #tk-sidebar #tk-sync[data-state="noClient"],
      #tk-sidebar #tk-sync[data-state="unavailable"] {
        cursor: default;
        opacity: 0.55;
      }

      /* Name of each icon, shown to the right on hover. It sits outside
         the bar, so the bar can scroll in a short window */
      #tk-tip {
        background: #012a3f;
        border: 1px solid #1e3a52;
        border-radius: 4px;
        color: #d6deeb;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 13px;
        left: 60px;
        opacity: 0;
        padding: 3px 8px;
        pointer-events: none;
        position: fixed;
        text-transform: lowercase;
        transform: translateY(-50%);
        transition: opacity 0.15s;
        white-space: nowrap;
        z-index: 950;
      }
      #tk-tip.show { opacity: 1; }

      /* Quick switcher */
      #tk-switch {
        align-items: flex-start;
        background: rgba(1, 10, 18, 0.45);
        display: flex;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        inset: 0;
        justify-content: center;
        padding-top: 14vh;
        position: fixed;
        z-index: 2000;
      }
      #tk-switch .tk-sw-box {
        background: #01111f;
        border: 1px solid #1e3a52;
        border-radius: 6px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        max-width: calc(100vw - 32px);
        overflow: hidden;
        width: 520px;
      }
      #tk-switch input {
        background: transparent;
        border: none;
        border-bottom: 1px solid #1e3a52;
        color: #d6deeb;
        font: inherit;
        font-size: 16px;
        outline: none;
        padding: 12px 14px;
        width: 100%;
      }
      #tk-switch input::placeholder { color: #6c7a89; }
      #tk-switch .tk-sw-list {
        max-height: 50vh;
        overflow-y: auto;
        padding: 4px;
      }
      #tk-switch .tk-sw-item {
        align-items: center;
        border-radius: 4px;
        color: #d6deeb;
        cursor: pointer;
        display: flex;
        font-size: 14px;
        gap: 10px;
        padding: 6px 10px;
      }
      #tk-switch .tk-sw-item svg {
        color: #7fdbca;
        flex-shrink: 0;
        height: 18px;
        width: 18px;
      }
      #tk-switch .tk-sw-item.hl { background: #012a3f; }
      #tk-switch .tk-sw-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #tk-switch .tk-sw-kind,
      #tk-switch .tk-sw-empty {
        color: #6c7a89;
        font-size: 12px;
        text-transform: lowercase;
      }
      #tk-switch .tk-sw-empty { padding: 8px 10px; }

      /* Undo toast */
      #tk-toast {
        align-items: center;
        background: #01111f;
        border: 1px solid #1e3a52;
        border-radius: 6px;
        bottom: 20px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
        color: #d6deeb;
        display: flex;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        gap: 12px;
        left: calc(50% + 30px);
        opacity: 0;
        padding: 8px 10px 8px 14px;
        pointer-events: none;
        position: fixed;
        text-transform: lowercase;
        transform: translate(-50%, 8px);
        transition: opacity 0.2s, transform 0.2s;
        z-index: 1900;
      }
      #tk-toast.show {
        opacity: 1;
        pointer-events: auto;
        transform: translate(-50%, 0);
      }
      #tk-toast button {
        background: none;
        border: 1px solid #1e3a52;
        border-radius: 4px;
        color: #7fdbca;
        cursor: pointer;
        font: inherit;
        padding: 2px 9px;
      }
      #tk-toast button:hover { border-color: #7fdbca; }
      body:not(.has-sidebar) #tk-toast { left: 50%; }

      /* Focus timer: a chip at the bottom left while it runs */
      #tk-focus-chip {
        align-items: center;
        background: #01111f;
        border: 1px solid #1e3a52;
        border-radius: 6px;
        bottom: 16px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
        color: #d6deeb;
        cursor: pointer;
        display: flex;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        gap: 8px;
        left: 76px;
        max-width: 300px;
        padding: 6px 12px 6px 10px;
        position: fixed;
        text-decoration: none;
        z-index: 1800;
      }
      #tk-focus-chip[hidden] { display: none; }
      #tk-focus-chip:hover { border-color: #7fdbca; }
      #tk-focus-chip .tk-fc-icon { color: #7fdbca; display: flex; }
      #tk-focus-chip .tk-fc-time {
        color: #7fdbca;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      #tk-focus-chip .tk-fc-task {
        color: #8a96a3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Focus timer: a banner that slides down at 0 */
      #tk-focus-banner {
        align-items: center;
        background: #01111f;
        border: 1px solid #7fdbca;
        border-radius: 8px;
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.4);
        color: #d6deeb;
        display: flex;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 15px;
        gap: 12px;
        left: calc(50% + 30px);
        max-width: min(560px, calc(100vw - 100px));
        opacity: 0;
        padding: 10px 10px 10px 16px;
        pointer-events: none;
        position: fixed;
        top: 14px;
        transform: translate(-50%, -140%);
        transition: opacity 0.25s, transform 0.35s cubic-bezier(.2, 1.3, .4, 1);
        z-index: 2000;
      }
      body:not(.has-sidebar) #tk-focus-banner { left: 50%; }
      #tk-focus-banner.show {
        opacity: 1;
        pointer-events: auto;
        transform: translate(-50%, 0);
      }
      #tk-focus-banner .tk-fb-main {
        align-items: center;
        background: none;
        border: none;
        color: inherit;
        cursor: pointer;
        display: flex;
        font: inherit;
        gap: 10px;
        min-width: 0;
        padding: 0;
        text-align: left;
      }
      #tk-focus-banner .tk-fb-title { color: #7fdbca; font-weight: 600;
        white-space: nowrap; }
      #tk-focus-banner .tk-fb-task {
        color: #8a96a3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #tk-focus-banner .tk-fb-close {
        background: none;
        border: none;
        color: #6c7a89;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0 4px;
      }
      #tk-focus-banner .tk-fb-close:hover { color: #d6deeb; }

      /* Tighter spacing in short windows */
      @media (max-height: 640px) {
        #tk-sidebar .tk-btn { height: 34px; }
        #tk-sidebar .tk-group { gap: 2px; }
        #tk-sidebar .tk-rule { margin: 8px 0 6px; }
      }
    `;
    document.head.appendChild(style);
  }

  function build() {
    nav = document.createElement("nav");
    nav.id = "tk-sidebar";
    const root = cfg.root || "../";

    // Three stacked layers, with the title, lead to the dashboard
    nav.innerHTML = '<a class="tk-home" href="' + root
      + 'dashboard/index.html" aria-label="dashboard" title="dashboard">'
      + svg(LAYERS) + '<div class="tk-title">orbita</div></a>'
      + '<hr class="tk-rule"><div class="tk-group tk-items"></div>'
      + '<div class="tk-group tk-controls"></div>';
    if (cfg.active === "dashboard") {
      nav.querySelector(".tk-home").classList.add("active");
    }

    const items = nav.querySelector(".tk-items");
    let sub = null;
    ITEMS.forEach(item => {
      // Help sits with the controls at the bottom of the bar
      if (item.id === "help") return;
      if (item.id === "todos") {
        items.appendChild(todosButton(item));
        sub = document.createElement("div");
        sub.className = "tk-sub";
        sub.innerHTML = '<div class="tk-sub-inner"></div>';
        items.appendChild(sub);
        return;
      }
      const a = document.createElement("a");
      a.className = "tk-btn";
      a.dataset.id = item.id;
      a.dataset.label = item.label;
      a.setAttribute("aria-label", item.label);
      a.href = root + (item.page || "to-dos/index.html#" + item.id);
      a.innerHTML = item.icon;
      a.addEventListener("click", e => {
        // Choosing a view folds the list into that view's icon
        if (TODO_VIEWS.includes(item.id)) {
          store(VIEW_KEY, item.id);
          setTodosOpen(false, true);
          showTodosIcon();
        }
        if (item.id === "focus" && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          focusGo();
          return;
        }
        if (cfg.onView && cfg.onView(item.id)) {
          e.preventDefault();
          setActive(item.id);
        }
      });
      (TODO_VIEWS.includes(item.id) ? sub.firstChild : items).appendChild(a);
    });
    setTodosOpen(false, false);
    showTodosIcon();

    // Clicking anywhere else folds the list of views away
    document.addEventListener("pointerdown", e => {
      if (todosOpen() && !e.target.closest(".tk-sub, "
        + '.tk-btn[data-id="todos"]')) setTodosOpen(false, true);
    });

    const controls = nav.querySelector(".tk-controls");
    ["mode", "size", "width"].forEach(kind => {
      const b = document.createElement("button");
      b.className = "tk-btn";
      b.id = "tk-" + kind;
      b.type = "button";
      b.addEventListener("click", () => cycle(kind));
      controls.appendChild(b);
    });

    // Help, between the width control and sync
    const helpItem = ITEMS.find(x => x.id === "help");
    const help = document.createElement("a");
    help.className = "tk-btn";
    help.dataset.id = helpItem.id;
    help.dataset.label = helpItem.label;
    help.setAttribute("aria-label", helpItem.label);
    help.href = root + helpItem.page;
    help.innerHTML = helpItem.icon;
    controls.appendChild(help);

    // Shown while ambience plays; clicking it stops the ambience
    const amb = document.createElement("button");
    amb.className = "tk-btn";
    amb.hidden = true;
    amb.id = "tk-ambience";
    amb.type = "button";
    amb.innerHTML = AMBIENCE_ICON;
    amb.addEventListener("click", () => {
      const S = sounds();
      if (S) S.stopAmbience();
    });
    controls.appendChild(amb);
    const playingNow = sounds() && sounds().current();
    if (playingNow || ambienceName) setAmbience(playingNow || ambienceName);

    // Hidden until sync.js reports a state
    const s = document.createElement("button");
    s.className = "tk-btn";
    s.hidden = true;
    s.id = "tk-sync";
    s.type = "button";
    s.addEventListener("click", e => {
      if (window.ToolSync && ToolSync.click) ToolSync.click(e);
    });
    controls.appendChild(s);

    document.body.prepend(nav);
    document.body.classList.add("has-sidebar");

    tip = document.createElement("div");
    tip.id = "tk-tip";
    document.body.appendChild(tip);
    nav.addEventListener("mouseover", e => {
      const b = e.target.closest(".tk-btn");
      if (b) showTip(b);
    });
    nav.addEventListener("mouseout", e => {
      const b = e.target.closest(".tk-btn");
      if (b && !b.contains(e.relatedTarget)) hideTip();
    });
    nav.addEventListener("scroll", hideTip);
  }

  function showTip(b) {
    tipFor = b;
    const r = b.getBoundingClientRect();
    tip.textContent = b.dataset.label;
    tip.style.top = (r.top + r.height / 2) + "px";
    tip.classList.add("show");
  }

  function hideTip() {
    tipFor = null;
    if (tip) tip.classList.remove("show");
  }

  // Keep the label in step when a control changes under the pointer
  function updateTip() {
    if (tipFor) tip.textContent = tipFor.dataset.label;
  }

  // The to-dos icon opens and closes its views rather than linking
  function todosButton(item) {
    const b = document.createElement("button");
    b.className = "tk-btn";
    b.type = "button";
    b.dataset.id = item.id;
    b.dataset.label = item.label;
    b.setAttribute("aria-label", item.label);
    b.innerHTML = item.icon + '<svg class="tk-chev" width="7" height="5" '
      + 'viewBox="0 0 7 5"><path d="M0.5 0.8L3.5 4l3-3.2" fill="none" '
      + 'stroke="currentColor" stroke-width="1.2"/></svg>';
    // Opens the list of views until one is chosen
    b.addEventListener("click", () => setTodosOpen(!todosOpen(), true));
    return b;
  }

  // The to dos button keeps its checkbox; its label names the last view
  function showTodosIcon() {
    const btn = nav && nav.querySelector('.tk-btn[data-id="todos"]');
    if (!btn) return;
    const v = read(VIEW_KEY);
    const label = TODO_VIEWS.includes(v) ? "to dos: " + VIEW_NAMES[v]
      : "to dos";
    btn.dataset.label = label;
    btn.setAttribute("aria-label", label);
  }

  // The list of views starts closed on every page
  function todosOpen() {
    const sub = nav && nav.querySelector(".tk-sub");
    return !!sub && sub.dataset.state === "open";
  }

  function setTodosOpen(open, animate) {
    const sub = nav.querySelector(".tk-sub");
    const btn = nav.querySelector('.tk-btn[data-id="todos"]');
    if (!sub || !btn) return;
    if (!animate) {
      sub.style.transition = "none";
      sub.firstChild.style.transition = "none";
    }
    sub.dataset.state = open ? "open" : "closed";
    sub.classList.toggle("open", open);
    btn.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    sub.querySelectorAll(".tk-btn").forEach(a => {
      a.tabIndex = open ? 0 : -1;
    });
    if (!animate) {
      void sub.offsetHeight;
      sub.style.transition = "";
      sub.firstChild.style.transition = "";
    }
    markParent();
  }

  // Show the to-dos icon as active when a hidden view is the current one
  function markParent() {
    const btn = nav.querySelector('.tk-btn[data-id="todos"]');
    if (!btn) return;
    const inside = !!nav.querySelector(".tk-sub .tk-btn.active");
    btn.classList.toggle("active", inside && !todosOpen());
    btn.classList.toggle("has-active", inside && todosOpen());
  }

  // Move a control to its next setting
  function cycle(kind) {
    const list = CYCLE[kind];
    const now = kind === "mode" ? mode : cfg[kind].get();
    const next = list[(list.indexOf(now) + 1) % list.length];
    if (kind === "mode") {
      mode = next;
      store(MODE_KEY, mode);
      cfg.mode.apply(mode, true);
    } else {
      cfg[kind].set(next);
      store(SHARED[kind], next);
    }
    refresh();
  }

  // Size and width are shared by every page
  function applyShared(animate) {
    ["size", "width"].forEach(kind => {
      if (!cfg[kind]) return;
      const v = read(SHARED[kind]);
      if (CYCLE[kind].includes(v)) {
        if (cfg[kind].get() !== v) cfg[kind].set(v);
      } else {
        store(SHARED[kind], cfg[kind].get());
      }
    });
    refresh();
  }

  // Show each control's current setting
  function refresh() {
    if (!nav) return;
    const set = (kind, icon, label) => {
      const b = nav.querySelector("#tk-" + kind);
      b.innerHTML = icon;
      b.dataset.label = label;
      b.setAttribute("aria-label", label);
    };
    set("mode", MODE_ICON[mode], "mode: " + mode);
    const s = cfg.size.get(), w = cfg.width.get();
    set("size", sizeIcon(s), "size: " + NAMES[s]);
    set("width", widthIcon(w), "width: " + w);
    updateTip();
  }

  // Show sync.js's state on the sync icon
  // A speaker with sound waves, for ambience that is playing
  const AMBIENCE_ICON = svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>'
    + '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>');
  let ambienceName = null;

  function setAmbience(name) {
    ambienceName = name || null;
    if (!nav) return;
    const b = nav.querySelector("#tk-ambience");
    if (!b) return;
    b.hidden = !ambienceName;
    const label = ambienceName ? "ambience: " + ambienceName + ", click to stop" : "";
    b.dataset.label = label;
    b.setAttribute("aria-label", label);
    updateTip();
  }

  function setSync(state, label) {
    syncState = { label, state };
    if (!nav) return;
    const b = nav.querySelector("#tk-sync");
    const off = state === "noClient" || state === "unavailable";
    b.hidden = false;
    b.innerHTML = syncIcon(off);
    b.dataset.state = state;
    b.dataset.label = label;
    b.setAttribute("aria-label", label);
    updateTip();
  }

  // ---- Tab icon and title ----

  function addTabIcon() {
    if (document.querySelector('link[rel="icon"]')) return;
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
      + '<path d="M18 7a26 26 0 1 1-11 13" fill="none" stroke="#7fdbca" '
      + 'stroke-width="4.5" stroke-linecap="round"/>'
      + '<circle cx="32" cy="32" r="13" fill="#7fdbca"/>'
      + '<circle cx="14" cy="12" r="5" fill="#7fdbca"/>'
      + '</svg>');
    document.head.appendChild(link);
  }

  // "week · to dos · orbita"
  function title(...parts) {
    document.title = parts.filter(Boolean).concat("orbita").join(" · ");
    // Inside the app shell, the shell's tab shows this title too
    try {
      if (window.parent !== window && window.parent.ToolkitShell) {
        window.parent.ToolkitShell.mirror();
      }
    } catch {}
  }

  // The ambience player: this page's, or the app shell's around it
  function sounds() {
    if (window.ToolkitSounds) return window.ToolkitSounds;
    try {
      return window.parent !== window ? window.parent.ToolkitSounds || null : null;
    } catch {
      return null;
    }
  }

  // ---- Undo toast ----

  let toastEl = null, toastTimer = null;

  function toast(message, undo, action) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "tk-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    clearTimeout(toastTimer);
    toastEl.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = message;
    toastEl.appendChild(text);
    if (undo) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "undo";
      btn.addEventListener("click", () => {
        hideToast();
        undo();
      });
      toastEl.appendChild(btn);
    }
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", () => {
        hideToast();
        action.run();
      });
      toastEl.appendChild(btn);
    }
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    toastTimer = setTimeout(hideToast, 6000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (toastEl) toastEl.classList.remove("show");
  }

  // Preserve unreadable saved data before a tool falls back to an empty view.
  // Recovery notices already shown on this page, so re-renders don't repeat them
  const shownRecovery = new Set();

  // An existing recovery copy of key holding exactly raw, if any
  function findRecovery(key, raw) {
    const prefix = "recovery-backup-" + key + "-";
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix) && localStorage.getItem(k) === raw) {
          return k;
        }
      }
    } catch {}
    return null;
  }

  function preserveRecovery(key, raw) {
    if (raw == null) return false;
    // Every tool reads the same data, so the same unreadable copy is seen
    // on each page load. Keep it once rather than filling storage with
    // duplicates.
    let saved = !!findRecovery(key, raw);
    if (!saved) {
      const backupKey = "recovery-backup-" + key + "-" + Date.now()
        + "-" + Math.random().toString(36).slice(2, 7);
      try {
        localStorage.setItem(backupKey, raw);
        saved = true;
      } catch {}
    }
    if (shownRecovery.has(key + "\n" + raw)) return saved;
    shownRecovery.add(key + "\n" + raw);
    toast(saved
      ? "Saved data couldn't be read; a recovery copy was kept."
      : "Saved data couldn't be read; download a recovery copy now.", null, {
      label: "download copy",
      run: () => {
        const blob = new Blob([raw], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = key + "-recovery.txt";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    return saved;
  }

  // ---- Quick switcher ----

  let sw = null;

  function notesData() {
    try {
      const d = JSON.parse(read("notes-data"));
      if (d && Array.isArray(d.notes)) return d;
    } catch {}
    return { folders: [], notes: [] };
  }

  // Everywhere the switcher can go
  function destinations() {
    const root = cfg.root || "../";
    const icon = id => (ITEMS.find(x => x.id === id) || {}).icon || "";
    const out = [
      { href: root + "dashboard/index.html", icon: svg(LAYERS),
        kind: "page", name: "dashboard" },
      { href: root + "notes/index.html", icon: icon("notes"),
        kind: "page", name: "notes" }
    ];
    TODO_VIEWS.forEach(v => out.push({
      href: root + "to-dos/index.html#" + v, icon: icon(v),
      kind: "to dos", name: VIEW_NAMES[v]
    }));
    out.push({ href: root + "codepad/index.html", icon: icon("codepad"),
      kind: "page", name: "codepad" });
    out.push({ href: root + "focus/index.html", icon: icon("focus"),
      kind: "page", name: "focus" });

    const data = notesData();
    const folders = Array.isArray(data.folders) ? data.folders : [];
    const path = id => {
      const names = [];
      for (let f = folders.find(x => x.id === id), n = 0; f && n < 20;
        f = folders.find(x => x.id === f.parent), n++) names.unshift(f.name);
      return names.join(" / ");
    };
    folders.forEach(f => out.push({
      href: root + "notes/index.html#folder=" + encodeURIComponent(f.id),
      icon: folderIcon(f.icon), kind: path(f.parent) || "folder",
      name: f.name
    }));
    data.notes.filter(n => !n.trashed)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .forEach(n => out.push({
        href: root + "notes/index.html#" + encodeURIComponent(n.id),
        icon: icon("notes"), kind: path(n.folder) || "note",
        name: (n.title || "").trim() || "untitled"
      }));
    return out;
  }

  // Best matches first: starts with, then contains, then letters in order
  function rank(name, q) {
    const s = name.toLowerCase();
    if (!q) return 1;
    if (s.startsWith(q)) return 3;
    if (s.includes(q)) return 2;
    let k = 0;
    for (const ch of s) if (ch === q[k]) k++;
    return k === q.length ? 1 : 0;
  }

  function openSwitcher() {
    if (sw) return;
    const all = destinations();
    sw = document.createElement("div");
    sw.id = "tk-switch";
    sw.innerHTML = '<div class="tk-sw-box" role="dialog" '
      + 'aria-label="quick switcher"><input type="text" spellcheck="false" '
      + 'autocomplete="off" placeholder="go to a note, folder or view">'
      + '<div class="tk-sw-list"></div></div>';
    document.body.appendChild(sw);
    const input = sw.querySelector("input");
    const list = sw.querySelector(".tk-sw-list");
    let shown = [], index = 0;

    const draw = () => {
      const q = input.value.trim().toLowerCase();
      shown = all.map((d, i) => ({ d, i, r: rank(d.name, q) }))
        .filter(x => x.r > 0)
        .sort((a, b) => b.r - a.r || a.i - b.i)
        .slice(0, 12).map(x => x.d);
      index = Math.min(index, Math.max(0, shown.length - 1));
      list.innerHTML = "";
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "tk-sw-empty";
        empty.textContent = "nothing matches";
        list.appendChild(empty);
        return;
      }
      shown.forEach((d, k) => {
        const row = document.createElement("div");
        row.className = "tk-sw-item" + (k === index ? " hl" : "");
        row.innerHTML = d.icon + '<span class="tk-sw-name"></span>'
          + '<span class="tk-sw-kind"></span>';
        row.querySelector(".tk-sw-name").textContent = d.name;
        row.querySelector(".tk-sw-kind").textContent = d.kind;
        row.addEventListener("mousemove", () => {
          if (index === k) return;
          index = k;
          list.querySelectorAll(".tk-sw-item").forEach((r, j) => {
            r.classList.toggle("hl", j === k);
          });
        });
        row.addEventListener("click", () => go(d));
        list.appendChild(row);
      });
      const hl = list.querySelector(".hl");
      if (hl) hl.scrollIntoView({ block: "nearest" });
    };
    const go = d => {
      closeSwitcher();
      location.href = d.href;
    };
    input.addEventListener("input", () => {
      index = 0;
      draw();
    });
    input.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        closeSwitcher();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!shown.length) return;
        index = (index + (e.key === "ArrowDown" ? 1 : shown.length - 1))
          % shown.length;
        draw();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (shown[index]) go(shown[index]);
      }
    });
    sw.addEventListener("mousedown", e => {
      if (e.target === sw) closeSwitcher();
    });
    draw();
    input.focus();
  }

  function closeSwitcher() {
    if (sw) sw.remove();
    sw = null;
  }

  // Ctrl+K, unless the page used it (as a note does for links)
  document.addEventListener("keydown", e => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey
      || e.altKey || e.key.toLowerCase() !== "k") return;
    e.preventDefault();
    if (sw) closeSwitcher();
    else openSwitcher();
  });

  function setActive(id) {
    if (!nav) return;
    nav.querySelectorAll(".tk-items .tk-btn, .tk-controls a.tk-btn").forEach(a => {
      if (a.dataset.id === "todos") return;
      a.classList.toggle("active", a.dataset.id === id);
    });
    if (TODO_VIEWS.includes(id) && read(VIEW_KEY) !== id) {
      store(VIEW_KEY, id);
      showTodosIcon();
    }
    markParent();
  }

  function init(options) {
    cfg = options;
    const saved = read(MODE_KEY);
    mode = CYCLE.mode.includes(saved) ? saved
      : CYCLE.mode.includes(cfg.mode.initial) ? cfg.mode.initial : "dark";
    store(MODE_KEY, mode);
    cfg.mode.apply(mode, false);

    addStyles();
    addTabIcon();
    if (!cfg.bare) {
      // Remember the page so the toolkit's address reopens it. The focus
      // page shows the bar while picking a task, but isn't remembered.
      if (!cfg.focusPage) store(LAST_KEY, cfg.page || "to-dos/index.html");
      build();
      setActive(cfg.active);
      applyShared();

      // Focus mode returns to the last page left
      if (!cfg.focusPage) {
        window.addEventListener("pagehide", () => store(FROM_KEY, location.href));
      }
    }
    startFocus();

    // Catch up if sync.js started before the sidebar
    if (syncState) setSync(syncState.state, syncState.label);
    else if (window.ToolSync && ToolSync.notify) ToolSync.notify();

    // Follow mode changes made in another tab
    window.addEventListener("storage", e => {
      if (e.key === MODE_KEY && CYCLE.mode.includes(e.newValue)
        && e.newValue !== mode) {
        mode = e.newValue;
        cfg.mode.apply(mode, true);
        refresh();
      }
      if (e.key === FOCUS_KEY) checkFocus();
      if (!cfg.bare && (e.key === SHARED.size || e.key === SHARED.width)) {
        applyShared();
      }
    });
  }

  // ---- Focus timer ----
  //
  // One focal task and its timer, kept in localStorage so the countdown
  // carries on across pages and after the app is closed:
  //   { task: { kind: "todo", fid } | { kind: "note", noteId, blockId },
  //     text, minutes, state: "idle" | "running" | "paused" | "expired",
  //     endAt, remaining, alerted, bannerOff }

  const FOCUS_KEY = "focus-state";
  const FROM_KEY  = "focus-from";
  let focusChip = null, focusBanner = null, focusTimer = 0;
  const focusListeners = [];

  function focusGet() {
    try {
      const s = JSON.parse(read(FOCUS_KEY));
      if (s && typeof s === "object") return s;
    } catch {}
    return { state: "idle" };
  }

  function focusSet(s) {
    store(FOCUS_KEY, JSON.stringify(s));
    checkFocus();
  }

  function sameRef(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    return a.kind === "todo" ? a.fid === b.fid
      : a.noteId === b.noteId && a.blockId === b.blockId;
  }

  // Milliseconds left on the timer
  function focusLeft(s) {
    if (s.state === "running") return Math.max(0, s.endAt - Date.now());
    if (s.state === "paused") return s.remaining || 0;
    if (s.state === "expired") return 0;
    return (s.minutes || 0) * 60000;
  }

  // 600000 → "10:00"
  function clock(ms) {
    const secs = Math.ceil(ms / 1000);
    return Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
  }

  // Open focus mode, on a task if given. A different task resets the
  // timer; without one, the picker shows unless a timer is going
  function focusGo(ref, text) {
    let s = focusGet();
    if (ref) {
      if (!sameRef(s.task, ref)) s = { state: "idle", task: ref };
      if (text !== undefined) s.text = text;
    } else if (!["running", "paused", "expired"].includes(s.state)) {
      s = { state: "idle" };
    }
    store(FOCUS_KEY, JSON.stringify(s));
    location.href = (cfg && cfg.root || "../") + "focus/index.html";
  }

  // ---- Chimes ----
  //
  // Sounds made in the browser for when the timer runs out. The focus
  // settings choose one and its volume ("focus-settings" in storage);
  // chime(name, volume) plays a given one, for previews.

  const SETTINGS_KEY = "focus-settings";
  // Each chime: notes as [frequency, start (s), length (s), wave, peak]
  const CHIMES = {
    // A soft rising triad
    chime: [[784, 0, 1.8, "sine", 0.16], [1046.5, 0.32, 1.8, "sine", 0.16],
      [1318.5, 0.64, 1.8, "sine", 0.16]],
    // One bell strike with a bright overtone
    ding: [[1318.5, 0, 2.6, "sine", 0.2], [2637, 0, 1.2, "sine", 0.05],
      [3951, 0, 0.5, "sine", 0.02]],
    // Quick high notes tumbling upwards
    sparkle: [[1568, 0, 0.6, "triangle", 0.09], [2093, 0.08, 0.6, "triangle", 0.09],
      [2637, 0.16, 0.7, "triangle", 0.09], [3136, 0.24, 0.8, "triangle", 0.08],
      [4186, 0.32, 1.1, "sine", 0.06]],
    // Two low, slow notes
    soft: [[523.25, 0, 2.4, "sine", 0.14], [659.25, 0.45, 2.6, "sine", 0.12]]
  };

  function chimeSettings() {
    try {
      const s = JSON.parse(read(SETTINGS_KEY)) || {};
      return {
        name: CHIMES[s.chime] ? s.chime : "chime",
        volume: Number.isFinite(s.chimeVolume)
          ? Math.min(1, Math.max(0, s.chimeVolume)) : 0.7
      };
    } catch {
      return { name: "chime", volume: 0.7 };
    }
  }

  function chime(name, volume) {
    const saved = chimeSettings();
    const notes = CHIMES[name] || CHIMES[saved.name];
    const level = Number.isFinite(volume) ? volume : saved.volume;
    if (!level) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      if (ctx.state === "suspended") ctx.resume();
      let end = 0;
      notes.forEach(([f, t, len, wave, peak]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        const at = ctx.currentTime + t;
        o.type = wave;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * level * 1.4),
          at + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(at);
        o.stop(at + len + 0.1);
        end = Math.max(end, t + len);
      });
      setTimeout(() => ctx.close(), (end + 1) * 1000);
    } catch {}
  }

  const PLAY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" '
    + 'fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" '
    + 'fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/>'
    + '<rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';

  function renderChip(s) {
    const show = cfg && !cfg.bare && !cfg.focusPage
      && ["running", "paused", "expired"].includes(s.state);
    if (!show) {
      if (focusChip) focusChip.hidden = true;
      return;
    }
    if (!focusChip) {
      focusChip = document.createElement("a");
      focusChip.id = "tk-focus-chip";
      focusChip.href = (cfg.root || "../") + "focus/index.html";
      focusChip.title = "back to focus mode";
      focusChip.innerHTML = '<span class="tk-fc-icon"></span>'
        + '<span class="tk-fc-time"></span><span class="tk-fc-task"></span>';
      document.body.appendChild(focusChip);
    }
    focusChip.hidden = false;
    focusChip.dataset.state = s.state;
    focusChip.querySelector(".tk-fc-icon").innerHTML =
      s.state === "running" ? PLAY_ICON
        : s.state === "paused" ? PAUSE_ICON : "⏰";
    focusChip.querySelector(".tk-fc-time").textContent =
      s.state === "expired" ? "time's up" : clock(focusLeft(s));
    focusChip.querySelector(".tk-fc-task").textContent = s.text || "";
  }

  function renderBanner(s) {
    const show = s.state === "expired" && !s.bannerOff;
    if (!focusBanner) {
      if (!show) return;
      focusBanner = document.createElement("div");
      focusBanner.id = "tk-focus-banner";
      focusBanner.setAttribute("role", "alert");
      focusBanner.innerHTML = '<button class="tk-fb-main" type="button">'
        + '<span class="tk-fb-title">⏰ time\'s up</span>'
        + '<span class="tk-fb-task"></span></button>'
        + '<button class="tk-fb-close" type="button" aria-label="dismiss">'
        + '×</button>';
      const off = () => {
        const cur = focusGet();
        cur.bannerOff = true;
        focusSet(cur);
      };
      focusBanner.querySelector(".tk-fb-main").addEventListener("click", () => {
        off();
        if (!cfg.bare && !cfg.focusPage) focusGo();
      });
      focusBanner.querySelector(".tk-fb-close").addEventListener("click", off);
      document.body.appendChild(focusBanner);
      void focusBanner.offsetWidth;
    }
    focusBanner.querySelector(".tk-fb-task").textContent = s.text || "";
    focusBanner.classList.toggle("show", show);
  }

  // Each second: run out the timer, then update the chip and banner
  function checkFocus() {
    const s = focusGet();
    if (s.state === "running" && Date.now() >= s.endAt) {
      s.state = "expired";
      s.remaining = 0;
      const first = !s.alerted;
      s.alerted = true;
      s.bannerOff = false;
      store(FOCUS_KEY, JSON.stringify(s));
      if (first) chime();
    }
    renderChip(s);
    renderBanner(s);
    focusListeners.forEach(fn => fn(s));
  }

  function startFocus() {
    clearInterval(focusTimer);
    focusTimer = setInterval(checkFocus, 1000);
    checkFocus();
  }

  // ---- Modal window ----
  //
  // A window in the middle of the screen over a dimmed page, in the current
  // light or dark mode. Resolves with the chosen button's value, or null when
  // closed with Esc, the close button or a click on the dimmed page.
  //   ToolkitSidebar.modal({
  //     title: "sync conflict",
  //     body: "Text or a DOM node",
  //     buttons: [{ label: "local", detail: "keep this device's copy",
  //                 value: "LOCAL" }, ...]
  //   }).then(value => ...)
  // With input: { placeholder } instead of buttons, Enter resolves with
  // the typed text.

  const MODAL_THEMES = {
    dark: { bg: "#01111f", line: "#1e3a52", fg: "#d6deeb", muted: "#8291a5",
      accent: "#7fdbca", hover: "#012a3f", dim: "rgba(1, 10, 18, 0.6)" },
    light: { bg: "#ffffff", line: "#d7e0e8", fg: "#233044", muted: "#607086",
      accent: "#147d70", hover: "#eef3f6", dim: "rgba(35, 48, 68, 0.35)" }
  };
  let modalClose = null;

  function addModalStyles() {
    if (document.getElementById("tk-modal-style")) return;
    const style = document.createElement("style");
    style.id = "tk-modal-style";
    style.textContent = `
      .tk-modal {
        align-items: center;
        background: var(--tkm-dim);
        display: flex;
        font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
        inset: 0;
        justify-content: center;
        opacity: 0;
        padding: 16px;
        position: fixed;
        transition: opacity 0.2s ease;
        z-index: 2100;
      }
      .tk-modal.show { opacity: 1; }
      .tk-modal .tkm-box {
        background: var(--tkm-bg);
        border: 1px solid var(--tkm-line);
        border-radius: 10px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
        color: var(--tkm-fg);
        max-width: 100%;
        padding: 20px 22px 18px;
        position: relative;
        transform: translateY(10px) scale(0.97);
        transition: transform 0.22s ease;
        width: 440px;
      }
      .tk-modal.show .tkm-box { transform: none; }
      .tk-modal h2 {
        font-size: 17px;
        font-weight: 600;
        margin: 0 28px 10px 0;
        text-transform: lowercase;
      }
      .tk-modal .tkm-body { font-size: 14px; line-height: 1.55; }
      .tk-modal .untitled .tkm-body { margin-right: 30px; }
      .tk-modal .tkm-body p { margin: 0 0 8px; }
      .tk-modal .tkm-muted { color: var(--tkm-muted); font-size: 13px; }
      .tk-modal .tkm-input {
        background: transparent;
        border: 1px solid var(--tkm-line);
        border-radius: 8px;
        color: var(--tkm-fg);
        font: inherit;
        font-size: 16px;
        margin-top: 4px;
        outline: none;
        padding: 10px 12px;
        transition: border-color 0.15s;
        width: 100%;
      }
      .tk-modal .tkm-input:focus { border-color: var(--tkm-accent); }
      .tk-modal .tkm-input::placeholder { color: var(--tkm-muted); }
      .tk-modal .tkm-buttons:empty { display: none; }
      .tk-modal .tkm-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      .tk-modal .tkm-choice {
        background: transparent;
        border: 1px solid var(--tkm-line);
        border-radius: 8px;
        color: var(--tkm-fg);
        cursor: pointer;
        flex: 1 1 160px;
        font: inherit;
        padding: 10px 12px;
        text-align: left;
        transition: border-color 0.15s, background 0.15s;
      }
      .tk-modal .tkm-choice:hover,
      .tk-modal .tkm-choice:focus-visible {
        background: var(--tkm-hover);
        border-color: var(--tkm-accent);
        outline: none;
      }
      .tk-modal .tkm-label {
        color: var(--tkm-accent);
        display: block;
        font-size: 15px;
        font-weight: 600;
      }
      .tk-modal .tkm-detail {
        color: var(--tkm-muted);
        display: block;
        font-size: 12.5px;
        margin-top: 2px;
      }
      .tk-modal .tkm-close {
        background: none;
        border: none;
        border-radius: 6px;
        color: var(--tkm-muted);
        cursor: pointer;
        font-size: 20px;
        height: 30px;
        line-height: 1;
        position: absolute;
        right: 10px;
        top: 10px;
        width: 30px;
      }
      .tk-modal .tkm-close:hover,
      .tk-modal .tkm-close:focus-visible {
        background: var(--tkm-hover);
        color: var(--tkm-fg);
        outline: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .tk-modal, .tk-modal .tkm-box { transition: none; }
        .tk-modal .tkm-box { transform: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function modal(opts) {
    if (modalClose) modalClose(null);
    addModalStyles();
    const theme = MODAL_THEMES[read(MODE_KEY) || mode] || MODAL_THEMES.dark;
    const before = document.activeElement;

    const wrap = document.createElement("div");
    wrap.id = "tk-modal";
    wrap.className = "tk-modal";
    Object.entries(theme).forEach(([k, v]) =>
      wrap.style.setProperty("--tkm-" + k, v));
    const box = document.createElement("div");
    box.className = "tkm-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    // Without a title, opts.label names the window for screen readers
    if (opts.title) box.setAttribute("aria-labelledby", "tkm-title");
    else box.setAttribute("aria-label", opts.label || "");

    const title = document.createElement("h2");
    title.id = "tkm-title";
    title.textContent = opts.title || "";
    if (!opts.title) {
      title.hidden = true;
      box.classList.add("untitled");
    }
    const body = document.createElement("div");
    body.className = "tkm-body";
    if (typeof opts.body === "string") {
      const p = document.createElement("p");
      p.textContent = opts.body;
      body.appendChild(p);
    } else if (opts.body) {
      body.appendChild(opts.body);
    }

    // An optional text field: Enter resolves with its trimmed text
    let input = null;
    if (opts.input) {
      input = document.createElement("input");
      input.className = "tkm-input";
      input.autocomplete = "off";
      input.placeholder = opts.input.placeholder || "";
      input.setAttribute("aria-label", opts.input.label || opts.title
        || opts.label || "");
      input.addEventListener("keydown", e => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        const text = input.value.trim();
        if (text) done(text);
      });
      body.appendChild(input);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tkm-close";
    close.setAttribute("aria-label", "close");
    close.textContent = "×";

    const row = document.createElement("div");
    row.className = "tkm-buttons";
    (opts.buttons || []).forEach(btn => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tkm-choice";
      b.dataset.value = btn.value;
      const label = document.createElement("span");
      label.className = "tkm-label";
      label.textContent = btn.label;
      b.appendChild(label);
      if (btn.detail) {
        const detail = document.createElement("span");
        detail.className = "tkm-detail";
        detail.textContent = btn.detail;
        b.appendChild(detail);
      }
      b.addEventListener("click", () => done(btn.value));
      row.appendChild(b);
    });

    box.append(close, title, body, row);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    // Fade in only if it wasn't closed before the next frame
    requestAnimationFrame(() => {
      if (modalClose === done) wrap.classList.add("show");
    });

    let resolve;
    const result = new Promise(r => { resolve = r; });
    function done(value) {
      if (modalClose !== done) return;
      modalClose = null;
      document.removeEventListener("keydown", onKey, true);
      // A closing window fades out without blocking a new one
      wrap.removeAttribute("id");
      title.removeAttribute("id");
      box.removeAttribute("aria-labelledby");
      wrap.classList.remove("show");
      wrap.style.pointerEvents = "none";
      const remove = () => wrap.remove();
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) remove();
      else setTimeout(remove, 220);
      if (before && before.focus) before.focus();
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      } else if (e.key === "Tab") {
        // Keep keyboard focus inside the window
        const items = Array.from(box.querySelectorAll("button, input, "
          + "textarea, select, [tabindex]:not([tabindex='-1'])"));
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    modalClose = done;
    close.addEventListener("click", () => done(null));
    wrap.addEventListener("pointerdown", e => {
      if (e.target === wrap) done(null);
    });
    document.addEventListener("keydown", onKey, true);
    (input || row.querySelector("button") || close).focus();
    return result;
  }

  // A view's icon, for pages that link to the tools
  function icon(id) {
    const item = ITEMS.find(x => x.id === id);
    return item ? item.icon : "";
  }

  window.ToolkitSidebar = {
    folderIcon, folderIcons: Object.keys(FOLDER_ICONS), icon, init, modal,
    setAmbience,
    openSwitcher, preserveRecovery, refresh, setActive, setSync, title, toast
  };

  window.ToolkitFocus = {
    check: checkFocus, chime, clock, from: () => read(FROM_KEY),
    get: focusGet, go: focusGo, left: focusLeft,
    onTick: fn => focusListeners.push(fn), sameRef, set: focusSet
  };

})();
