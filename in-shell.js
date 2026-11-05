// Tools open inside the app shell (the site's index.html), which keeps
// ambience playing between them. A tool opened on its own reopens there
// straight away; add ?standalone to the address to open it alone.
(function () {
  if (window.top !== window || location.protocol === "file:"
      || /[?&]standalone\b/.test(location.search)) return;
  const m = location.pathname.match(/^(.*\/)([^/]+)\/(index\.html)?$/);
  if (!m) return;
  const inner = location.hash.replace(/^#/, "");
  location.replace(m[1] + "#" + m[2] + (inner ? "/" + inner : ""));
})();
