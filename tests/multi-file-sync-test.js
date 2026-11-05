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

  function waitFor(test, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (test()) return resolve();
        if (Date.now() - start > timeout) {
          return reject(new Error("Timed out waiting for both files to sync."));
        }
        window.__syncTestNativeSetTimeout(check, 20);
      };
      check();
    });
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
    const todoFile = "sync-multi-test-todos-" + suffix + ".json";
    const notesFile = "sync-multi-test-notes-" + suffix + ".json";
    const todoKey = "sync-multi-test-todo-data-" + suffix;
    const notesKey = "sync-multi-test-notes-data-" + suffix;
    const todoId = "mock-todo-file-" + suffix;
    const notesId = "mock-notes-file-" + suffix;
    const todoMeta = "sync-meta-" + todoFile;
    const notesMeta = "sync-meta-" + notesFile;
    const originalToken = localStorage.getItem(TOKEN_KEY);
    const originalFetch = window.fetch;
    const passed = [];
    const remotes = new Map([
      [todoId, { updated: 100, data: { [todoKey]: "todo-base" } }],
      [notesId, { updated: 100, data: { [notesKey]: "notes-base" } }]
    ]);
    const patches = [];
    const requests = [];

    const fileIds = { [todoFile]: todoId, [notesFile]: notesId };

    window.fetch = async (url, options = {}) => {
      const method = options.method || "GET";
      if (method === "GET" && url.includes("spaces=appDataFolder")) {
        const name = decodeURIComponent(url).match(/name = '([^']+)'/);
        const id = name && fileIds[name[1]];
        return { ok: true, status: 200,
          json: async () => ({ files: id ? [{ id }] : [] }) };
      }
      for (const [id, remote] of remotes) {
        if (url.includes("/files/" + id + "?alt=media") && method === "GET") {
          requests.push({ id, method });
          return { ok: true, status: 200, json: async () => remote };
        }
        if (url.includes("/upload/drive/v3/files/" + id)
            && method === "PATCH") {
          const payload = JSON.parse(options.body);
          remotes.set(id, payload);
          requests.push({ id, method });
          patches.push({ id, payload });
          return { ok: true, status: 200, json: async () => ({}) };
        }
      }
      throw new Error("Unexpected mocked Drive request: " + method + " " + url);
    };

    try {
      removeRaw(TOKEN_KEY);
      setRaw(todoKey, "todo-base");
      setRaw(notesKey, "notes-base");
      setRaw(todoMeta, JSON.stringify({ fileId: todoId, synced: 100, updated: 100 }));
      setRaw(notesMeta, JSON.stringify({ fileId: notesId, synced: 100, updated: 100 }));

      ToolSync.init({ file: todoFile, keys: [todoKey] });
      ToolSync.init({ file: notesFile, keys: [notesKey] });
      setRaw(TOKEN_KEY, JSON.stringify({
        expires: Date.now() + 3600000, token: "mock-test-token"
      }));
      await ToolSync.sync();
      assert(ToolSync.status() === "synced",
        "Both registered files reach the synced state.", passed);

      // These writes represent a note-task checkbox and an ordinary to-do edit.
      requests.length = 0;
      localStorage.setItem(notesKey, "notes-updated");
      localStorage.setItem(todoKey, "todo-updated");
      if (typeof window.__syncTestPageHide !== "function") {
        throw new Error("The sync page-hide handler was not registered.");
      }
      window.__syncTestPageHide(new Event("pagehide"));
      await waitFor(() => patches.length === 2
        && ToolSync.status() === "synced");

      const todoPatch = patches.find(item => item.id === todoId);
      const notesPatch = patches.find(item => item.id === notesId);
      assert(!!todoPatch && todoPatch.payload.data[todoKey] === "todo-updated",
        "The to-dos key flushes to to-dos.json on page hide.", passed);
      assert(!!notesPatch && notesPatch.payload.data[notesKey] === "notes-updated",
        "The notes key flushes to notes.json on page hide.", passed);
      assert(!(todoKey in notesPatch.payload.data)
        && !(notesKey in todoPatch.payload.data),
        "Each file contains only its own registered keys.", passed);
      assert([todoId, notesId].every(id => {
        const own = requests.filter(item => item.id === id);
        return own.length === 2 && own[0].method === "GET"
          && own[1].method === "PATCH";
      }), "Page hide reads Drive before uploading each file.", passed);

      // Another device saves notes, then this device edits before its
      // next sync and the page is hidden. Drive's copy must survive.
      patches.length = 0;
      remotes.set(notesId, { updated: Date.now() + 60000,
        data: { [notesKey]: "notes-other-device" } });
      localStorage.setItem(notesKey, "notes-this-device");
      window.__syncTestPageHide(new Event("pagehide"));
      await waitFor(() => ToolSync.status() === "conflict");
      assert(patches.length === 0
        && remotes.get(notesId).data[notesKey] === "notes-other-device",
        "Page hide does not overwrite a newer Drive copy.", passed);
      assert(localStorage.getItem(notesKey) === "notes-this-device"
        && !!localStorage.getItem("sync-conflict-" + notesFile),
        "This device's edit is kept and the conflict is recorded.", passed);

      result.textContent = "PASS\n" + passed.map(x => "✓ " + x).join("\n");
    } catch (error) {
      result.textContent = "FAIL\n" + error.message
        + "\n\n" + passed.map(x => "✓ " + x).join("\n");
    } finally {
      window.fetch = originalFetch;
      removeRaw(todoKey);
      removeRaw(notesKey);
      removeRaw(todoMeta);
      removeRaw(notesMeta);
      for (const file of [todoFile, notesFile]) {
        removeRaw("sync-backup-" + file);
        removeRaw("sync-backup-" + file + "-remote");
        removeRaw("sync-conflict-" + file);
      }
      if (originalToken === null) removeRaw(TOKEN_KEY);
      else setRaw(TOKEN_KEY, originalToken);
      Storage.prototype.setItem = nativeSet;
      Storage.prototype.removeItem = nativeRemove;
      window.setTimeout = window.__syncTestNativeSetTimeout;
      window.clearTimeout = window.__syncTestNativeClearTimeout;
      EventTarget.prototype.addEventListener =
        window.__syncTestNativeAddEventListener;
    }
  }

  runButton.addEventListener("click", run);
})();
