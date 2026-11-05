(function () {
  "use strict";

  const TOKEN_KEY = "sync-google-token";
  const runButton = document.getElementById("run");
  const result = document.getElementById("result");
  const nativeSet = window.__syncTestNativeSet;
  const nativeRemove = window.__syncTestNativeRemove;
  let ran = false;

  function setRaw(key, value) {
    nativeSet.call(localStorage, key, value);
  }

  function removeRaw(key) {
    nativeRemove.call(localStorage, key);
  }

  function assert(condition, message, passed) {
    if (!condition) throw new Error(message);
    passed.push(message);
  }

  async function run() {
    if (location.protocol === "file:") {
      result.textContent = "FAIL\nOpen this page through the local HTTP "
        + "server, not as a file:// URL.";
      return;
    }
    if (ran) return;
    ran = true;
    runButton.disabled = true;

    const suffix = Date.now();
    const passed = [];
    const originalToken = localStorage.getItem(TOKEN_KEY);
    const originalFetch = window.fetch;
    const tempKeys = [];

    // Each case: Drive holds an older file and a duplicate made later by
    // another device. This device has the duplicate's id saved.
    const cases = [
      { name: "newer", keep: 100, extra: 200 },
      { name: "older", keep: 300, extra: 200 }
    ].map(c => {
      const file = "sync-dup-test-" + c.name + "-" + suffix + ".json";
      const key = "sync-dup-test-data-" + c.name + "-" + suffix;
      return Object.assign(c, {
        file, key,
        keepId: "dup-keep-" + c.name + "-" + suffix,
        extraId: "dup-extra-" + c.name + "-" + suffix
      });
    });

    // Fake Drive: files by id, listed oldest first per name
    const drive = new Map();
    const order = new Map();
    const requests = [];
    cases.forEach(c => {
      drive.set(c.keepId, { updated: c.keep, data: { [c.key]: "keep-copy" } });
      drive.set(c.extraId, { updated: c.extra, data: { [c.key]: "extra-copy" } });
      order.set(c.file, [c.keepId, c.extraId]);
    });

    window.fetch = async (url, options = {}) => {
      const method = options.method || "GET";
      requests.push({ url, method });
      if (method === "GET" && url.includes("spaces=appDataFolder")) {
        const name = decodeURIComponent(url).match(/name = '([^']+)'/);
        const ids = (name && order.get(name[1]) || [])
          .filter(id => drive.has(id));
        return { ok: true, status: 200,
          json: async () => ({ files: ids.map(id => ({ id })) }) };
      }
      for (const id of drive.keys()) {
        if (url.includes("/files/" + id + "?alt=media") && method === "GET") {
          const remote = drive.get(id);
          return { ok: true, status: 200, json: async () => remote };
        }
        if (url.includes("/upload/drive/v3/files/" + id) && method === "PATCH") {
          drive.set(id, JSON.parse(options.body));
          return { ok: true, status: 200, json: async () => ({}) };
        }
        if (url.endsWith("/files/" + id) && method === "DELETE") {
          drive.delete(id);
          return { ok: true, status: 204, json: async () => ({}) };
        }
      }
      throw new Error("Unexpected mocked Drive request: " + method + " " + url);
    };

    try {
      removeRaw(TOKEN_KEY);
      cases.forEach(c => {
        tempKeys.push(c.key, "sync-meta-" + c.file, "sync-backup-" + c.file,
          "sync-backup-" + c.file + "-remote", "sync-conflict-" + c.file,
          "sync-backup-" + c.file + "-duplicate-" + c.extraId);
        setRaw(c.key, "extra-copy");
        setRaw("sync-meta-" + c.file, JSON.stringify({
          fileId: c.extraId, synced: c.extra, updated: c.extra
        }));
        ToolSync.init({ file: c.file, keys: [c.key] });
      });
      setRaw(TOKEN_KEY, JSON.stringify({
        expires: Date.now() + 3600000, token: "mock-test-token"
      }));
      await ToolSync.sync();

      assert(ToolSync.status() === "synced",
        "Both files reach the synced state.", passed);
      cases.forEach(c => {
        const meta = JSON.parse(localStorage.getItem("sync-meta-" + c.file));
        const backup = JSON.parse(localStorage.getItem(
          "sync-backup-" + c.file + "-duplicate-" + c.extraId));
        assert(!drive.has(c.extraId),
          "The " + c.name + " duplicate is deleted from Drive.", passed);
        assert(meta.fileId === c.keepId,
          "This device switches to the oldest file (" + c.name + " case).",
          passed);
        assert(backup && backup.data[c.key] === "extra-copy",
          "A local backup of the " + c.name + " duplicate is kept.", passed);
      });

      const [newer, older] = cases;
      assert(drive.get(newer.keepId).data[newer.key] === "extra-copy"
        && localStorage.getItem(newer.key) === "extra-copy",
        "A newer duplicate's data is copied into the kept file.", passed);
      assert(drive.get(older.keepId).data[older.key] === "keep-copy"
        && localStorage.getItem(older.key) === "keep-copy",
        "An older duplicate does not replace newer data.", passed);
      assert(!requests.some(r => r.method === "PATCH"
        && r.url.includes(older.keepId)),
        "The kept file is not rewritten when it is already newest.", passed);

      result.textContent = "PASS\n" + passed.map(x => "✓ " + x).join("\n");
    } catch (error) {
      result.textContent = "FAIL\n" + error.message
        + "\n\n" + passed.map(x => "✓ " + x).join("\n");
    } finally {
      window.fetch = originalFetch;
      tempKeys.forEach(removeRaw);
      if (originalToken === null) removeRaw(TOKEN_KEY);
      else setRaw(TOKEN_KEY, originalToken);
      Storage.prototype.setItem = nativeSet;
      Storage.prototype.removeItem = nativeRemove;
    }
  }

  runButton.addEventListener("click", run);
})();
