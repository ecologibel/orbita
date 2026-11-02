(function () {
  "use strict";

  const API = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
  const TOKEN_KEY = "sync-google-token";
  const CLEANUP_KEY = "toolkit-drive-concurrency-probe-file-id";

  const runButton = document.getElementById("run-probe");
  const cleanupButton = document.getElementById("retry-cleanup");
  const result = document.getElementById("probe-result");

  function setResult(message) {
    result.textContent = message;
    cleanupButton.disabled = !localStorage.getItem(CLEANUP_KEY);
  }

  function token() {
    try {
      const saved = JSON.parse(localStorage.getItem(TOKEN_KEY));
      return saved && saved.expires > Date.now() + 60000
        ? saved.token : null;
    } catch {
      return null;
    }
  }

  function authHeaders(accessToken, extra = {}) {
    return Object.assign({}, extra, {
      Authorization: "Bearer " + accessToken
    });
  }

  async function metadata(accessToken, fileId) {
    return fetch(API + "/" + encodeURIComponent(fileId)
      + "?fields=id,name,version", {
      headers: authHeaders(accessToken)
    });
  }

  async function content(accessToken, fileId) {
    const response = await fetch(API + "/" + encodeURIComponent(fileId)
      + "?alt=media", {
      headers: authHeaders(accessToken)
    });
    if (!response.ok) throw new Error("Read-back failed (HTTP "
      + response.status + ").");
    return response.json();
  }

  async function deleteFile(accessToken, fileId) {
    const response = await fetch(API + "/" + encodeURIComponent(fileId), {
      headers: authHeaders(accessToken),
      method: "DELETE"
    });
    if (response.ok || response.status === 404) {
      localStorage.removeItem(CLEANUP_KEY);
      return true;
    }
    return false;
  }

  async function retryCleanup() {
    const fileId = localStorage.getItem(CLEANUP_KEY);
    const accessToken = token();
    if (!fileId) {
      setResult("There is no probe file awaiting cleanup.");
      return;
    }
    if (!accessToken) {
      setResult("The local sync token is missing or expired. Sign in to sync "
        + "from another toolkit page, then retry cleanup here.");
      return;
    }
    cleanupButton.disabled = true;
    try {
      const deleted = await deleteFile(accessToken, fileId);
      setResult(deleted ? "Temporary probe file deleted."
        : "Cleanup failed. The probe file ID is retained locally; retry cleanup.");
    } catch {
      setResult("Cleanup request failed. The probe file ID is retained locally; "
        + "retry cleanup.");
    }
  }

  async function runProbe() {
    if (location.origin !== "http://localhost:8000") {
      setResult("For safety, this probe runs only at http://localhost:8000.");
      return;
    }

    if (localStorage.getItem(CLEANUP_KEY)) {
      setResult("A previous probe file still needs cleanup. Use Retry cleanup "
        + "before creating another.");
      return;
    }

    const accessToken = token();
    if (!accessToken) {
      setResult("The local sync token is missing or expired. Sign in to sync "
        + "from another toolkit page, then reload this page.");
      return;
    }

    runButton.disabled = true;
    cleanupButton.disabled = true;
    let fileId = null;
    let outcome = "Probe did not complete.";
    try {
      const suffix = Date.now().toString(36) + "-"
        + Math.random().toString(36).slice(2, 9);
      const name = "toolkit-drive-concurrency-probe-" + suffix + ".json";
      const boundary = "toolkit-probe-" + suffix;
      const fileMetadata = JSON.stringify({
        mimeType: "application/json",
        name,
        parents: ["appDataFolder"]
      });
      const initialContent = JSON.stringify({ probe: "base" });
      const multipart = "--" + boundary
        + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
        + fileMetadata + "\r\n--" + boundary
        + "\r\nContent-Type: application/json\r\n\r\n"
        + initialContent + "\r\n--" + boundary + "--";

      const created = await fetch(UPLOAD
        + "?uploadType=multipart&fields=id,name", {
        body: multipart,
        headers: authHeaders(accessToken, {
          "Content-Type": "multipart/related; boundary=" + boundary
        }),
        method: "POST"
      });
      if (!created.ok) {
        throw new Error("Could not create the temporary file (HTTP "
          + created.status + ").");
      }
      const createdFile = await created.json();
      if (!createdFile || typeof createdFile.id !== "string") {
        throw new Error("Drive did not return a temporary file ID.");
      }
      fileId = createdFile.id;
      localStorage.setItem(CLEANUP_KEY, fileId);
      cleanupButton.disabled = false;

      const before = await metadata(accessToken, fileId);
      if (!before.ok) {
        throw new Error("Could not read temporary file metadata (HTTP "
          + before.status + ").");
      }
      const beforeData = await before.json();
      const firstEtag = before.headers.get("ETag");
      if (!firstEtag) {
        throw new Error("The browser could not read Drive's ETag header; "
          + "conditional-update support is inconclusive.");
      }

      const firstWrite = await fetch(UPLOAD + "/" + encodeURIComponent(fileId)
        + "?uploadType=media", {
        body: JSON.stringify({ probe: "first" }),
        headers: authHeaders(accessToken, {
          "Content-Type": "application/json",
          "If-Match": firstEtag
        }),
        method: "PATCH"
      });
      if (!firstWrite.ok) {
        throw new Error("The current-ETag update failed (HTTP "
          + firstWrite.status + "); no stale-update conclusion can be drawn.");
      }

      const afterFirst = await metadata(accessToken, fileId);
      if (!afterFirst.ok) {
        throw new Error("Could not re-read temporary file metadata (HTTP "
          + afterFirst.status + ").");
      }
      const afterFirstData = await afterFirst.json();
      const currentEtag = afterFirst.headers.get("ETag");
      if (!currentEtag || currentEtag === firstEtag
          || (beforeData.version && afterFirstData.version
            && beforeData.version === afterFirstData.version)) {
        throw new Error("Drive did not expose a changed ETag/version; "
          + "the stale-update check is inconclusive.");
      }

      const staleWrite = await fetch(UPLOAD + "/" + encodeURIComponent(fileId)
        + "?uploadType=media", {
        body: JSON.stringify({ probe: "stale" }),
        headers: authHeaders(accessToken, {
          "Content-Type": "application/json",
          "If-Match": firstEtag
        }),
        method: "PATCH"
      });

      const finalContent = await content(accessToken, fileId);
      if (staleWrite.status === 412 && finalContent.probe === "first") {
        outcome = "PASS: Drive rejected the stale update (HTTP 412) and kept "
          + "the newer test content.";
      } else if (staleWrite.ok && finalContent.probe === "stale") {
        outcome = "FAIL: Drive accepted the stale update and overwrote the "
          + "newer test content. Do not add If-Match to sync.js.";
      } else {
        outcome = "INCONCLUSIVE: stale update returned HTTP "
          + staleWrite.status + " and read-back did not match either expected "
          + resultState(finalContent) + ".";
      }
    } catch (error) {
      outcome = "INCONCLUSIVE: " + error.message;
    } finally {
      if (fileId) {
        try {
          const deleted = await deleteFile(accessToken, fileId);
          outcome += deleted
            ? "\nTemporary probe file deleted."
            : "\nCLEANUP NEEDED: the temporary file ID is retained locally. "
              + "Use Retry cleanup.";
        } catch {
          outcome += "\nCLEANUP NEEDED: the temporary file ID is retained "
            + "locally. Use Retry cleanup.";
        }
      }
      setResult(outcome);
      runButton.disabled = !!localStorage.getItem(CLEANUP_KEY);
    }
  }

  function resultState(value) {
    return value && typeof value.probe === "string"
      ? JSON.stringify(value.probe) : "unexpected content";
  }

  runButton.addEventListener("click", runProbe);
  cleanupButton.addEventListener("click", retryCleanup);

  if (location.origin !== "http://localhost:8000") {
    runButton.disabled = true;
    result.textContent = "For safety, open this page at "
      + "http://localhost:8000/tests/drive-concurrency-probe.html.";
  } else if (localStorage.getItem(CLEANUP_KEY)) {
    cleanupButton.disabled = false;
    runButton.disabled = true;
    result.textContent = "A previous probe file may need cleanup. "
      + "Use Retry cleanup before running another probe.";
  }
})();
