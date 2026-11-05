// ---- Google Drive sync ----
//
// Each tool keeps working from localStorage. This script copies a tool's
// synced keys to a hidden app folder in the user's own Google Drive, so the
// data follows them across devices. The newest edit wins.
//
// Usage (after the tool's own script has loaded its data):
//   ToolSync.init({
//     file: "to-dos.json",
//     keys: ["todo-data"],
//     onRemote: () => renderCurrentView()
//   });
//   ToolSync.init({
//     file: "notes.json",
//     keys: ["notes-data"],
//     onRemote: () => renderCurrentView()
//   });
// Each file keeps separate metadata and conflict handling. The sync control
// reports the combined state and processes pending files independently.

(function () {

  // Paste the OAuth client ID from Google Cloud here
  const CLIENT_ID = "162961094882-4v360khh8d3hohj1arp3g80lgkoipdc9.apps.googleusercontent.com";

  const API        = "https://www.googleapis.com/drive/v3/files";
  const POLL_EVERY = 60000;
  const PUSH_DELAY = 2000;
  const SCOPE      = "https://www.googleapis.com/auth/drive.appdata";
  const TOKEN_KEY  = "sync-google-token";
  const UPLOAD     = "https://www.googleapis.com/upload/drive/v3/files";

  const LABELS = {
    error:     "Sync failed, retry",
    conflict:  "Resolve sync conflict",
    pending:   "Saving…",
    reconnect: "Reconnect sync",
    signedOut: "Sign in to sync",
    synced:    "Synced",
    syncing:   "Syncing…"
  };

  // Hover labels for the sidebar's sync icon
  const SIDEBAR = {
    error:       "sync failed, click to retry",
    conflict:    "conflict",
    noClient:    "sync: no client ID in sync.js",
    pending:     "syncing",
    reconnect:   "sign in to sync",
    signedOut:   "sign in to sync",
    synced:      "synced",
    syncing:     "syncing",
    unavailable: "sync: unavailable on local files"
  };

  const nativeRemove = Storage.prototype.removeItem;
  const nativeSet    = Storage.prototype.setItem;

  const configs = new Map();
  const runtime = new Map();
  let applying = false, btn = null, state = null, initialized = false;
  let tokenClient = null;

  // ---- Local metadata ----

  function metaKey(cfg) {
    return "sync-meta-" + cfg.file;
  }

  function conflictKey(cfg) {
    return "sync-conflict-" + cfg.file;
  }

  function loadMeta(cfg) {
    try {
      const m = JSON.parse(localStorage.getItem(metaKey(cfg)));
      if (m && typeof m === "object" && !Array.isArray(m)) {
        return {
          fileId: typeof m.fileId === "string" ? m.fileId : null,
          synced: Number.isFinite(m.synced) ? m.synced : 0,
          updated: Number.isFinite(m.updated) ? m.updated : 0
        };
      }
    } catch {}
    return { fileId: null, synced: 0, updated: 0 };
  }

  function saveMeta(cfg, m) {
    nativeSet.call(localStorage, metaKey(cfg), JSON.stringify(m));
  }

  function collect(cfg) {
    const data = {};
    cfg.keys.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    });
    return data;
  }

  function sameData(cfg, a, b) {
    return cfg.keys.every(k => (a && k in a ? a[k] : null)
      === (b && k in b ? b[k] : null));
  }

  function validRemote(cfg, remote) {
    if (!remote || typeof remote !== "object" || Array.isArray(remote)
        || !Number.isFinite(remote.updated) || remote.updated < 0
        || !remote.data || typeof remote.data !== "object"
        || Array.isArray(remote.data)) return false;
    return cfg.keys.every(k => !(k in remote.data)
      || typeof remote.data[k] === "string");
  }

  function backupRemote(cfg, remote) {
    try {
      nativeSet.call(localStorage, "sync-backup-" + cfg.file + "-remote",
        JSON.stringify({ data: remote.data, saved: Date.now(),
          updated: remote.updated }));
      return true;
    } catch (err) {
      console.warn("Sync: couldn't keep a remote backup", err);
      return false;
    }
  }

  function preserveConflict(cfg, remote) {
    if (!backupRemote(cfg, remote)) return false;
    try {
      nativeSet.call(localStorage, conflictKey(cfg), JSON.stringify({
        detected: Date.now(), updated: remote.updated
      }));
      return true;
    } catch (err) {
      console.warn("Sync: couldn't record the conflict", err);
      return false;
    }
  }

  function savedConflictRemote(cfg) {
    try {
      const saved = JSON.parse(localStorage.getItem(
        "sync-backup-" + cfg.file + "-remote"));
      return validRemote(cfg, saved) ? saved : null;
    } catch {
      return null;
    }
  }

  // Keep metadata edits made while an upload is in flight.
  function finishUpload(cfg, task, m, data, uploadedAt) {
    const latest = loadMeta(cfg);
    latest.fileId = m.fileId || latest.fileId;
    latest.synced = uploadedAt;
    latest.updated = Math.max(latest.updated || 0, uploadedAt);
    const unchanged = sameData(cfg, data, collect(cfg));
    if (!unchanged) {
      latest.updated = Math.max(latest.updated || 0, uploadedAt + 1);
      task.again = true;
    }
    saveMeta(cfg, latest);
    return unchanged;
  }

  // Record real edits to synced keys, ignoring re-saves of the same value
  function watch(fn) {
    return function (key, ...rest) {
      const tracked = this === localStorage && !applying
        ? Array.from(configs.values()).filter(cfg =>
          cfg.keys.includes(String(key))) : [];
      const before = new Map(tracked.map(cfg => [cfg, this.getItem(key)]));
      fn.call(this, key, ...rest);
      tracked.forEach(cfg => {
        if (this.getItem(key) !== before.get(cfg)) markChanged(cfg);
      });
    };
  }

  Storage.prototype.removeItem = watch(nativeRemove);
  Storage.prototype.setItem    = watch(nativeSet);

  function markChanged(cfg) {
    const task = runtime.get(cfg.file);
    if (!task) return;
    const m = loadMeta(cfg);
    m.updated = Math.max(Date.now(), m.updated + 1);
    saveMeta(cfg, m);
    if (!getToken()) return;
    setStatus("pending", cfg);
    clearTimeout(task.pushTimer);
    task.pushTimer = setTimeout(() => sync(cfg), PUSH_DELAY);
  }

  // ---- Auth ----

  function getToken() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
      if (t && t.expires > Date.now() + 60000) return t.token;
    } catch {}
    return null;
  }

  function onToken(resp) {
    if (resp.error) {
      configs.forEach(cfg => setStatus(signedOutState(cfg), cfg));
      return;
    }
    nativeSet.call(localStorage, TOKEN_KEY, JSON.stringify({
      expires: Date.now() + resp.expires_in * 1000,
      token:   resp.access_token
    }));
    syncAll();
  }

  function connect() {
    if (!window.google || !google.accounts) {
      setAllStatus("error");
      return;
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        callback:       onToken,
        client_id:      CLIENT_ID,
        error_callback: () => configs.forEach(cfg =>
          setStatus(signedOutState(cfg), cfg)),
        scope:          SCOPE
      });
    }
    tokenClient.requestAccessToken({ prompt: "select_account" });
  }

  function signOut() {
    const token = getToken();
    if (token && window.google) google.accounts.oauth2.revoke(token);
    nativeRemove.call(localStorage, TOKEN_KEY);
    configs.forEach(cfg => setStatus(signedOutState(cfg), cfg));
  }

  function signedOutState(cfg) {
    return loadMeta(cfg).synced ? "reconnect" : "signedOut";
  }

  // ---- Drive requests ----

  async function drive(url, opts = {}) {
    const token = getToken();
    if (!token) throw new Error("auth");
    const headers = Object.assign(
      {}, opts.headers, { Authorization: "Bearer " + token }
    );
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401) {
      nativeRemove.call(localStorage, TOKEN_KEY);
      throw new Error("auth");
    }
    if (!res.ok) throw new Error("http " + res.status);
    return res;
  }

  // Drive files with this name, oldest first
  async function listFiles(cfg) {
    const q = encodeURIComponent("name = '" + cfg.file + "' and trashed = false");
    const res = await drive(API + "?fields=files(id)&orderBy=createdTime"
      + "&spaces=appDataFolder&q=" + q);
    const { files } = await res.json();
    return Array.isArray(files)
      ? files.filter(f => f && typeof f.id === "string").map(f => f.id) : [];
  }

  async function readFile(cfg, id) {
    try {
      const res = await drive(API + "/" + id + "?alt=media");
      const remote = await res.json();
      return validRemote(cfg, remote) ? remote : null;
    } catch (err) {
      if (err.message === "http 404") return null;
      throw err;
    }
  }

  // Two devices syncing for the first time at once can each create a file.
  // Keep the oldest, so every device settles on the same one; copy in the
  // newest data from the others, keeping a local backup of each, then delete
  // them.
  async function mergeDuplicates(cfg, keepId, extraIds) {
    let best = await readFile(cfg, keepId), changed = false;
    for (const id of extraIds) {
      const extra = await readFile(cfg, id);
      if (!extra) continue;
      try {
        nativeSet.call(localStorage, "sync-backup-" + cfg.file + "-duplicate-"
          + id, JSON.stringify({ data: extra.data, saved: Date.now(),
          updated: extra.updated }));
      } catch (err) {
        throw new Error("duplicate backup failed");
      }
      if (!best || extra.updated > best.updated) {
        best = extra;
        changed = true;
      }
    }
    if (changed) await writeRemote(cfg, { fileId: keepId }, best);
    for (const id of extraIds) {
      try {
        await drive(API + "/" + id, { method: "DELETE" });
      } catch (err) {
        if (err.message !== "http 404") throw err;
      }
    }
  }

  async function findFile(cfg) {
    const ids = await listFiles(cfg);
    if (!ids.length) return null;
    if (ids.length > 1) await mergeDuplicates(cfg, ids[0], ids.slice(1));
    return ids[0];
  }

  async function readRemote(cfg, m) {
    const task = runtime.get(cfg.file);
    let retried = false;
    while (true) {
      // Look the file up once per page load, even when its id is saved, so
      // duplicates made on other devices are found and merged
      if (!m.fileId || (task && !task.checked)) {
        m.fileId = await findFile(cfg);
        if (task) task.checked = true;
      }
      if (!m.fileId) return null;
      try {
        const res = await drive(API + "/" + m.fileId + "?alt=media");
        const remote = await res.json();
        if (!validRemote(cfg, remote)) throw new Error("invalid remote data");
        return remote;
      } catch (err) {
        if (err.message !== "http 404" || retried) throw err;
        m.fileId = null;
        retried = true;
      }
    }
  }

  async function writeRemote(cfg, m, payload) {
    const body = JSON.stringify(payload);
    if (m.fileId) {
      await drive(UPLOAD + "/" + m.fileId + "?uploadType=media", {
        body,
        headers: { "Content-Type": "application/json" },
        method:  "PATCH"
      });
      return;
    }

    // Create the file in the hidden app folder
    const b = "sync-" + Math.random().toString(36).slice(2);
    const fileMeta = JSON.stringify({
      name:    cfg.file,
      parents: ["appDataFolder"]
    });
    const multipart =
      "--" + b + "\r\nContent-Type: application/json\r\n\r\n" +
      fileMeta + "\r\n--" + b +
      "\r\nContent-Type: application/json\r\n\r\n" +
      body + "\r\n--" + b + "--";
    const res = await drive(UPLOAD + "?fields=id&uploadType=multipart", {
      body:    multipart,
      headers: { "Content-Type": "multipart/related; boundary=" + b },
      method:  "POST"
    });
    m.fileId = (await res.json()).id;
  }

  // ---- Sync ----

  function applyRemote(cfg, m, remote) {
    const incoming = remote.data || {};
    const before = collect(cfg);
    const changed =
      JSON.stringify(before) !== JSON.stringify(incoming);

    // Keep the overwritten local copy as a one-step backup
    if (changed && Object.keys(before).length) {
      nativeSet.call(
        localStorage, "sync-backup-" + cfg.file,
        JSON.stringify({ data: before, saved: Date.now() })
      );
    }

    applying = true;
    try {
      cfg.keys.forEach(k => {
        if (k in incoming) localStorage.setItem(k, incoming[k]);
        else localStorage.removeItem(k);
      });
    } finally {
      applying = false;
    }

    m.synced = m.updated = remote.updated;
    saveMeta(cfg, m);
    if (changed && cfg.onRemote) cfg.onRemote();
  }

  async function sync(cfg) {
    const task = runtime.get(cfg.file);
    if (!task) return;
    if (!getToken()) {
      setStatus(signedOutState(cfg), cfg);
      return;
    }
    if (task.busy) {
      task.again = true;
      return;
    }
    task.busy = true;
    clearTimeout(task.pushTimer);
    task.pushTimer = null;
    setStatus("syncing", cfg);
    try {
      if (localStorage.getItem(conflictKey(cfg))) {
        setStatus("conflict", cfg);
        return;
      }
      const m = loadMeta(cfg);
      const startUpdated = m.updated;
      const remote = await readRemote(cfg, m);

      // Skip this round if the tool saved while the request ran
      if (loadMeta(cfg).updated !== startUpdated) {
        task.again = true;
      } else if (m.synced && m.updated > m.synced
          && remote && remote.updated > m.synced
          && !sameData(cfg, collect(cfg), remote.data)) {
        // Both this device and Drive changed since the last shared version.
        // Keep this device's data active and save Drive's copy for resolution.
        if (!preserveConflict(cfg, remote)) {
          throw new Error("conflict backup failed");
        }
        setStatus("conflict", cfg);
        return;
      } else if (!remote) {
        if (Object.keys(collect(cfg)).length) {
          m.updated = m.updated || Date.now();
          const data = collect(cfg), uploadedAt = m.updated;
          await writeRemote(cfg, m, { data, updated: uploadedAt });
          finishUpload(cfg, task, m, data, uploadedAt);
        } else {
          saveMeta(cfg, m);
        }

      // A device's first sync takes the Drive copy
      } else if (!m.synced || remote.updated > m.updated) {
        applyRemote(cfg, m, remote);
      } else if (remote.updated === m.updated
          && !sameData(cfg, collect(cfg), remote.data)) {
        // Equal timestamps can happen when two devices save in the same ms.
        // Keep the remote copy, then use this device's data as the winner.
        if (!backupRemote(cfg, remote)) throw new Error("backup failed");
        const data = collect(cfg);
        m.updated = Math.max(Date.now(), remote.updated + 1);
        saveMeta(cfg, m);
        const uploadedAt = m.updated;
        await writeRemote(cfg, m, { data, updated: uploadedAt });
        finishUpload(cfg, task, m, data, uploadedAt);
      } else if (m.updated > remote.updated) {
        // Preserve the remote winner before replacing it with newer local data.
        if (!backupRemote(cfg, remote)) throw new Error("backup failed");
        const data = collect(cfg), uploadedAt = m.updated;
        await writeRemote(cfg, m, { data, updated: uploadedAt });
        finishUpload(cfg, task, m, data, uploadedAt);
      } else {
        saveMeta(cfg, m);
      }
      setStatus("synced", cfg);
    } catch (err) {
      console.warn("Sync:", err);
      setStatus(err.message === "auth" ? signedOutState(cfg) : "error", cfg);
    } finally {
      task.busy = false;
      if (task.again) {
        task.again = false;
        sync(cfg);
      }
    }
  }

  // Send a pending save when the page is hidden or closed. This runs the
  // normal sync, which reads Drive first, so a change made on another device
  // is caught as a conflict instead of being overwritten. If the page closes
  // before the sync finishes, the edit stays marked as unsynced and is sent,
  // with the same check, the next time the app opens.
  function flush(cfg) {
    const task = runtime.get(cfg.file);
    if (!task || !task.pushTimer || !getToken()) return;
    sync(cfg);
  }

  function flushAll() {
    configs.forEach(flush);
  }

  // ---- Status button ----

  // Show the state on the sidebar's sync icon, if the page has one
  function notify() {
    if (!state) return;
    if (window.ToolkitSidebar && ToolkitSidebar.setSync) {
      ToolkitSidebar.setSync(state, SIDEBAR[state]);
    }
  }

  // Click signs in or syncs now; alt-click signs out
  function click(e) {
    if (state === "noClient" || state === "unavailable") return;
    if (e && e.altKey) signOut();
    else if (state === "conflict") resolveNextConflict();
    else if (getToken()) syncAll();
    else connect();
  }

  function resolveNextConflict() {
    const cfg = Array.from(configs.values()).find(item =>
      localStorage.getItem(conflictKey(item)));
    if (cfg) resolveConflict(cfg);
  }

  const TOOL_NAMES = { "notes.json": "notes", "to-dos.json": "to dos",
    "r-codepad.json": "codepad", "timekeeper.json": "timekeeper settings" };

  function toolName(cfg) {
    return TOOL_NAMES[cfg.file] || cfg.file.replace(/\.json$/, "");
  }

  // Ask which copy to keep: "LOCAL", "DRIVE", or null to decide later
  async function chooseCopy(cfg) {
    const name = toolName(cfg);
    if (!(window.ToolkitSidebar && ToolkitSidebar.modal)) {
      const answer = window.prompt(
        "Sync conflict in " + name + ": type LOCAL to keep this device's "
        + "copy, or DRIVE to use Drive's copy. Cancel to leave both unchanged."
      );
      if (answer === null) return null;
      const choice = answer.trim().toUpperCase();
      if (choice === "LOCAL" || choice === "DRIVE") return choice;
      window.alert("Type LOCAL or DRIVE. The conflict is still saved.");
      return null;
    }

    const when = t => t ? new Date(t).toLocaleString() : "an unknown time";
    const remote = savedConflictRemote(cfg);
    const body = document.createElement("div");
    const intro = document.createElement("p");
    intro.textContent = name + " changed on this device and in Google Drive "
      + "since they last synced. Choose which copy to keep.";
    const times = document.createElement("p");
    times.className = "tkm-muted";
    times.textContent = "this device: last changed " + when(loadMeta(cfg).updated)
      + " · drive: last changed " + when(remote && remote.updated);
    const kept = document.createElement("p");
    kept.className = "tkm-muted";
    kept.textContent = "The other copy is kept in backups on the help page.";
    body.append(intro, times, kept);
    return ToolkitSidebar.modal({
      title: "sync conflict in " + name,
      body,
      buttons: [
        { label: "local", detail: "keep this device's copy", value: "LOCAL" },
        { label: "drive", detail: "use Google Drive's copy", value: "DRIVE" }
      ]
    });
  }

  async function resolveConflict(cfg) {
    const task = runtime.get(cfg.file);
    if (!task || task.busy) return;
    const choice = await chooseCopy(cfg);
    if (choice !== "LOCAL" && choice !== "DRIVE") return;
    if (task.busy) return;

    const savedRemote = savedConflictRemote(cfg);
    if (!savedRemote) {
      setStatus("error", cfg);
      return;
    }

    task.busy = true;
    setStatus("syncing", cfg);
    try {
      const m = loadMeta(cfg);
      const latestRemote = await readRemote(cfg, m);
      if (!latestRemote) throw new Error("conflict remote missing");

      if (choice === "LOCAL") {
        // Keep a recovery copy of the latest Drive version before replacing it.
        if (!backupRemote(cfg, latestRemote)) throw new Error("backup failed");
        m.synced = latestRemote.updated;
        m.updated = Math.max(Date.now(), latestRemote.updated + 1);
        saveMeta(cfg, m);
        nativeRemove.call(localStorage, conflictKey(cfg));
        task.again = true;
      } else {
        // applyRemote saves this device's current data before replacing it.
        applyRemote(cfg, m, latestRemote);
        nativeRemove.call(localStorage, conflictKey(cfg));
        setStatus("synced", cfg);
      }
    } catch (err) {
      console.warn("Sync conflict resolution:", err);
      setStatus(err.message === "auth" ? signedOutState(cfg) : "error", cfg);
    } finally {
      task.busy = false;
      if (task.again) {
        task.again = false;
        sync(cfg);
      }
    }
  }

  function aggregateStatus() {
    const states = Array.from(runtime.values()).map(task => task.state);
    const priority = ["conflict", "error", "pending", "syncing",
      "reconnect", "signedOut", "noClient", "unavailable"];
    return priority.find(item => states.includes(item)) ||
      (states.length ? "synced" : null);
  }

  function setStatus(next, cfg) {
    if (cfg) {
      const task = runtime.get(cfg.file);
      if (task) task.state = next;
    } else {
      setAllStatus(next);
      return;
    }
    state = aggregateStatus();
    notify();
    if (!btn) return;
    btn.dataset.state = state;
    btn.textContent = LABELS[state];
    const last = Math.max(0, ...Array.from(configs.values())
      .map(item => loadMeta(item).synced));
    btn.title = getToken()
      ? "Click to sync now, alt-click to sign out" +
        (last ? "\nLast change: " + new Date(last).toLocaleString() : "")
      : "Sync with your Google Drive";
  }

  function setAllStatus(next) {
    configs.forEach(cfg => {
      const task = runtime.get(cfg.file);
      if (task) task.state = next;
    });
    state = aggregateStatus();
    notify();
    if (btn) {
      btn.dataset.state = state;
      btn.textContent = LABELS[state];
    }
  }

  function addButton() {
    const style = document.createElement("style");
    style.textContent = `
      #tool-sync {
        background: rgba(127, 127, 127, 0.12);
        border: 1px solid rgba(127, 127, 127, 0.3);
        border-radius: 999px;
        bottom: 12px;
        color: #8a96a3;
        cursor: pointer;
        font: 12px -apple-system, "Segoe UI", sans-serif;
        padding: 4px 10px;
        position: fixed;
        right: 12px;
        z-index: 1000;
      }
      #tool-sync:hover { border-color: #8a96a3; }
      #tool-sync[data-state="error"] { color: #e06c75; }
      #tool-sync[data-state="conflict"] { color: #e5c07b; }
      #tool-sync[data-state="synced"] { opacity: 0.6; }
    `;
    document.head.appendChild(style);

    btn = document.createElement("button");
    btn.id = "tool-sync";
    btn.type = "button";
    btn.addEventListener("click", click);
    document.body.appendChild(btn);
  }

  // ---- Init ----

  function init(options) {
    if (!options || typeof options.file !== "string"
        || !options.file || !Array.isArray(options.keys)
        || !options.keys.length) return;

    let cfg = configs.get(options.file);
    if (!cfg) {
      cfg = {
        file: options.file,
        keys: options.keys.slice(),
        onRemote: options.onRemote
      };
      configs.set(cfg.file, cfg);
      runtime.set(cfg.file, {
        again: false, busy: false, checked: false, pushTimer: null,
        state: null
      });
    } else {
      cfg.keys = options.keys.slice();
      cfg.onRemote = options.onRemote || cfg.onRemote;
    }

    // Google sign-in needs a hosted page, not file://
    if (location.protocol === "file:") {
      setStatus("unavailable", cfg);
      return;
    }
    if (CLIENT_ID.startsWith("YOUR_")) {
      console.info("Sync: add a client ID to sync.js to enable it");
      setStatus("noClient", cfg);
      return;
    }

    if (!initialized) {
      // Pages such as timekeeper already load Google sign-in for their own use
      if (!document.querySelector('script[src^="https://accounts.google.com/gsi/client"]')) {
        const gis = document.createElement("script");
        gis.async = true;
        gis.src = "https://accounts.google.com/gsi/client";
        document.head.appendChild(gis);
      }

      addButton();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushAll();
        else if (getToken()) syncAll();
      });
      window.addEventListener("online", () => {
        if (getToken()) syncAll();
      });
      window.addEventListener("pagehide", flushAll);
      setInterval(() => {
        if (document.visibilityState === "visible" && getToken()) syncAll();
      }, POLL_EVERY);
      initialized = true;
    }

    setStatus(getToken() ? "syncing" : signedOutState(cfg), cfg);
    if (getToken()) sync(cfg);
  }

  function syncAll() {
    return Promise.all(Array.from(configs.values()).map(sync));
  }

  window.ToolSync = {
    click, init, notify, signOut, sync: syncAll, status: () => state
  };

})();
