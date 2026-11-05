// ---- App shell ----
//
// The site's index.html stays open and shows each tool in a frame, so
// ambience (sounds.js) keeps playing as you move between tools. The
// address follows the tool in the frame:
//
//   #notes            notes/index.html
//   #notes/abc123     notes/index.html#abc123
//   #to-dos/simple    to-dos/index.html#simple
//
// Back and forward move through tools as before, since the frame's own
// navigation is part of the window's history. Each tool page includes
// in-shell.js, which reopens it inside the shell if it is opened alone.

(function () {
  "use strict";

  const TOOLS = ["dashboard", "notes", "to-dos", "focus", "codepad",
    "timekeeper", "help"];
  const frame = document.getElementById("frame");
  const base = new URL(".", location.href);

  // "#notes/abc" → the notes page with #abc
  function pageFor(hash) {
    const h = decodeURIComponent(String(hash || "").replace(/^#/, ""));
    const [tool, ...rest] = h.split("/");
    const known = TOOLS.includes(tool);
    const inner = known ? rest.join("/") : "";
    return new URL((known ? tool : "dashboard") + "/index.html"
      + (inner ? "#" + inner : ""), base).href;
  }

  // The notes page with #abc → "#notes/abc"; null for anything else
  function hashFor(href) {
    let u;
    try { u = new URL(href); } catch { return null; }
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) {
      return null;
    }
    const m = u.pathname.slice(base.pathname.length)
      .match(/^([^/]+)\/(index\.html)?$/);
    if (!m || !TOOLS.includes(m[1])) return null;
    const inner = u.hash.replace(/^#/, "");
    return "#" + m[1] + (inner ? "/" + inner : "");
  }

  // Keep the address and tab title in step with the tool in the frame
  function mirror() {
    let w;
    try { w = frame.contentWindow; } catch { return; }
    try {
      const h = hashFor(w.location.href);
      if (h && h !== location.hash) history.replaceState(null, "", h);
      if (w.document.title) document.title = w.document.title;
    } catch {}
  }

  frame.addEventListener("load", () => {
    mirror();
    try {
      frame.contentWindow.addEventListener("hashchange", mirror);
      frame.contentWindow.addEventListener("popstate", mirror);
    } catch {}
  });

  // An address typed or pasted into the bar opens that tool
  window.addEventListener("hashchange", () => {
    const want = pageFor(location.hash);
    try {
      if (frame.contentWindow.location.href !== want) {
        frame.contentWindow.location.href = want;
      }
    } catch {
      frame.src = want;
    }
  });

  // The tools tell the shell when their title changes
  window.ToolkitShell = { mirror };

  frame.src = pageFor(location.hash);
})();
