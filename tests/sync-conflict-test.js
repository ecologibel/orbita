(function () {
  "use strict";

  const TOKEN_KEY = "sync-google-token";
  const runButton = document.getElementById("run");
  const scenario = document.getElementById("resolution");
  const result = document.getElementById("result");
  let ran = false;

  const nativeSet = window.__syncTestNativeSet;
  const nativeRemove = window.__syncTestNativeRemove;

  function setRaw(key, value) {
    nativeSet.call(localStorage, key, value);
  }

  function removeRaw(key) {
    nativeRemove.call(localStorage, key);
  }

  function waitFor(test, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (test()) return resolve();
        if (Date.now() - start > timeout) {
          return reject(new Error("Timed out waiting for sync status."));
        }
        setTimeout(check, 20);
      };
      check();
    });
  }

  function assert(condition, message, passed) {
    if (!condition) throw new Error(message);
    passed.push(message);
  }

  async function run() {
    if (ran) return;
    ran = true;
    runButton.disabled = true;
    const choice = scenario.value;
    const file = "sync-conflict-test-" + Date.now() + ".json";
    const dataKey = "sync-test-data-" + Date.now();
    const metaKey = "sync-meta-" + file;
    const backupKey = "sync-backup-" + file;
    const remoteBackupKey = backupKey + "-remote";
    const conflictKey = "sync-conflict-" + file;
    const originalToken = localStorage.getItem(TOKEN_KEY);
    const originalFetch = window.fetch;
    const passed = [];
    const calls = [];
    let remote = { updated: 300, data: { [dataKey]: "drive-copy" } };
    let testFileId = "mock-drive-file";
    let patchCount = 0;

    window.fetch = async (url, options = {}) => {
      const method = options.method || "GET";
      calls.push({ url, method });
      if (method === "GET" && url.includes("spaces=appDataFolder")) {
        return { ok: true, status: 200,
          json: async () => ({ files: [{ id: testFileId }] }) };
      }
      if (url.includes("/files/" + testFileId + "?alt=media")
          && method === "GET") {
        return { ok: true, status: 200, json: async () => remote };
      }
      if (url.includes("/upload/drive/v3/files/" + testFileId)
          && method === "PATCH") {
        patchCount++;
        remote = JSON.parse(options.body);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      throw new Error("Unexpected mocked Drive request: " + method + " " + url);
    };

    try {
      removeRaw(TOKEN_KEY);
      setRaw(dataKey, "local-copy");
      setRaw(metaKey, JSON.stringify({
        fileId: testFileId, synced: 100, updated: 200
      }));

      ToolSync.init({ file, keys: [dataKey] });
      setRaw(TOKEN_KEY, JSON.stringify({
        expires: Date.now() + 3600000, token: "mock-test-token"
      }));
      await ToolSync.sync();

      assert(ToolSync.status() === "conflict",
        "Divergent local and Drive changes show conflict status.", passed);
      assert(localStorage.getItem(dataKey) === "local-copy",
        "The local copy stays active when the conflict is detected.", passed);
      const savedRemote = JSON.parse(localStorage.getItem(remoteBackupKey));
      assert(savedRemote && savedRemote.data[dataKey] === "drive-copy",
        "The Drive copy is backed up before resolution.", passed);
      assert(patchCount === 0,
        "Conflict detection does not overwrite Drive.", passed);

      if (choice !== "detect") {
        window.prompt = () => choice;
        ToolSync.click({});
        await waitFor(() => ToolSync.status() === "synced"
          && localStorage.getItem(conflictKey) === null);

        if (choice === "LOCAL") {
          assert(localStorage.getItem(dataKey) === "local-copy",
            "Choosing LOCAL keeps this device's copy active.", passed);
          assert(patchCount > 0 && remote.data[dataKey] === "local-copy",
            "Choosing LOCAL uploads this copy after backing up Drive.", passed);
        } else {
          assert(localStorage.getItem(dataKey) === "drive-copy",
            "Choosing DRIVE applies the saved Drive copy.", passed);
          const savedLocal = JSON.parse(localStorage.getItem(backupKey));
          assert(savedLocal && savedLocal.data[dataKey] === "local-copy",
            "Choosing DRIVE keeps a recovery copy of the local data.", passed);
        }
      }

      result.textContent = "PASS\n" + passed.map(x => "✓ " + x).join("\n");
    } catch (error) {
      result.textContent = "FAIL\n" + error.message
        + "\n\n" + passed.map(x => "✓ " + x).join("\n");
    } finally {
      window.fetch = originalFetch;
      window.prompt = window.__syncTestOriginalPrompt;
      removeRaw(dataKey);
      removeRaw(metaKey);
      removeRaw(backupKey);
      removeRaw(remoteBackupKey);
      removeRaw(conflictKey);
      if (originalToken === null) removeRaw(TOKEN_KEY);
      else setRaw(TOKEN_KEY, originalToken);
      Storage.prototype.setItem = nativeSet;
      Storage.prototype.removeItem = nativeRemove;
    }
  }

  window.__syncTestOriginalPrompt = window.prompt;
  runButton.addEventListener("click", run);
})();
