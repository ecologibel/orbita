(function () {
  "use strict";

  const TOKEN_KEY = "sync-google-token";
  const HOUR = 3600000;
  const runButton = document.getElementById("run");
  const result = document.getElementById("result");
  const nativeSet = window.__syncTestNativeSet;
  const nativeRemove = window.__syncTestNativeRemove;
  const realNow = () => window.__syncTestNativeNow.call(Date);
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

  function waitFor(test, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const start = realNow();
      const check = () => {
        if (test()) return resolve();
        if (realNow() - start > timeout) {
          return reject(new Error("Timed out waiting for sync status."));
        }
        setTimeout(check, 20);
      };
      check();
    });
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

    const suffix = realNow();
    const passed = [];
    const originalToken = localStorage.getItem(TOKEN_KEY);
    const originalFetch = window.fetch;
    const tempKeys = [];

    // One fake Drive file per case
    const drive = new Map();
    const patches = [];
    window.fetch = async (url, options = {}) => {
      const method = options.method || "GET";
      if (method === "GET" && url.includes("spaces=appDataFolder")) {
        const name = decodeURIComponent(url).match(/name = '([^']+)'/);
        const id = name && drive.has(name[1]) ? name[1] : null;
        return { ok: true, status: 200,
          json: async () => ({ files: id ? [{ id }] : [] }) };
      }
      for (const id of drive.keys()) {
        if (url.includes("/files/" + id + "?alt=media") && method === "GET") {
          const remote = drive.get(id);
          return { ok: true, status: 200, json: async () => remote };
        }
        if (url.includes("/upload/drive/v3/files/" + id) && method === "PATCH") {
          const payload = JSON.parse(options.body);
          drive.set(id, payload);
          patches.push({ id, payload });
          return { ok: true, status: 200, json: async () => ({}) };
        }
      }
      throw new Error("Unexpected mocked Drive request: " + method + " " + url);
    };

    function setup(name, remoteUpdated, synced) {
      const file = "sync-skew-test-" + name + "-" + suffix + ".json";
      const key = "sync-skew-test-data-" + name + "-" + suffix;
      tempKeys.push(key, "sync-meta-" + file, "sync-backup-" + file,
        "sync-backup-" + file + "-remote", "sync-conflict-" + file);
      drive.set(file, { updated: remoteUpdated, data: { [key]: "drive-copy" } });
      setRaw(key, "drive-copy");
      setRaw("sync-meta-" + file, JSON.stringify({
        fileId: file, synced, updated: synced
      }));
      ToolSync.init({ file, keys: [key] });
      return { file, key };
    }

    try {
      removeRaw(TOKEN_KEY);
      setRaw(TOKEN_KEY, JSON.stringify({
        expires: realNow() + 10 * HOUR, token: "mock-test-token"
      }));

      // 1. This device's clock is 2 hours slow. Its last sync took a version
      // stamped by a device whose clock is 2 hours fast. An edit made now
      // must still count as newer and be uploaded.
      window.__syncTestClockOffset = -2 * HOUR;
      const fastStamp = realNow() + 2 * HOUR;
      const slow = setup("slow", fastStamp, fastStamp);
      localStorage.setItem(slow.key, "slow-device-edit");
      await ToolSync.sync();
      await waitFor(() => patches.some(p => p.id === slow.file)
        && ToolSync.status() === "synced");
      const slowPatch = patches.find(p => p.id === slow.file);
      assert(slowPatch && slowPatch.payload.data[slow.key] === "slow-device-edit",
        "A device with a slow clock uploads an edit made after its last sync.",
        passed);
      assert(slowPatch.payload.updated > fastStamp,
        "That edit is stamped newer than the version it was based on.", passed);

      // 2. This device's clock is 2 hours fast. Another device (normal clock)
      // changed Drive since this device's last sync, and this device also
      // edited. The fast clock must not win silently: it's a conflict.
      window.__syncTestClockOffset = 2 * HOUR;
      const base = realNow() - HOUR;
      const fast = setup("fast", base + 1000, base);
      drive.set(fast.file, { updated: base + 1000,
        data: { [fast.key]: "other-device-edit" } });
      localStorage.setItem(fast.key, "fast-device-edit");
      await ToolSync.sync();
      await waitFor(() => !!localStorage.getItem("sync-conflict-" + fast.file));
      assert(!patches.some(p => p.id === fast.file)
        && drive.get(fast.file).data[fast.key] === "other-device-edit",
        "A device with a fast clock doesn't overwrite another device's newer"
        + " change.", passed);
      assert(localStorage.getItem(fast.key) === "fast-device-edit",
        "Both edits are kept, and the conflict is recorded for the user to"
        + " resolve.", passed);

      result.textContent = "PASS\n" + passed.map(x => "✓ " + x).join("\n");
    } catch (error) {
      result.textContent = "FAIL\n" + error.message
        + "\n\n" + passed.map(x => "✓ " + x).join("\n");
    } finally {
      window.__syncTestClockOffset = 0;
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
