"""Run the browser test pages headlessly and report the results.

Serves the repository over a local HTTP server, opens each test page in a
headless browser, runs it, and exits with a non-zero code if any test fails
or a page throws an error.

    pip install playwright
    python -m playwright install chromium
    python tests/run_browser_tests.py

Set BROWSER_CHANNEL=msedge (or chrome) to use an installed browser instead
of Playwright's own Chromium. The Drive concurrency probe is left out: it
needs a real Google sign-in.
"""

import functools
import http.server
import os
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
TIMEOUT_MS = 15000

# (label, page, scenario value for #resolution or None)
CLICK_TESTS = [
    ("multi-file sync", "tests/multi-file-sync-test.html", None),
    ("duplicate Drive files", "tests/duplicate-files-test.html", None),
    ("clock skew", "tests/clock-skew-test.html", None),
    ("sync conflict: detect", "tests/sync-conflict-test.html", "detect"),
    ("sync conflict: keep local", "tests/sync-conflict-test.html", "LOCAL"),
    ("sync conflict: use Drive", "tests/sync-conflict-test.html", "DRIVE"),
]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def open_page(browser, url, errors):
    # A fresh context per test keeps localStorage separate between runs
    context = browser.new_context()
    page = context.new_page()
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(url)
    return context, page


def run_recovery(browser, base):
    errors = []
    context, page = open_page(browser, base + "tests/recovery.html", errors)
    try:
        page.wait_for_selector("body[data-test-status]", timeout=TIMEOUT_MS)
        status = page.get_attribute("body", "data-test-status")
        text = page.inner_text("#results")
    finally:
        context.close()
    return status == "passed" and not errors, text, errors


def run_click_test(browser, base, path, scenario):
    errors = []
    context, page = open_page(browser, base + path, errors)
    try:
        if scenario:
            page.select_option("#resolution", scenario)
        page.click("#run")
        page.wait_for_function(
            "() => /^(PASS|FAIL)/.test("
            "document.getElementById('result').textContent)",
            timeout=TIMEOUT_MS)
        text = page.inner_text("#result")
    finally:
        context.close()
    return text.startswith("PASS") and not errors, text, errors


def main():
    server = start_server()
    base = "http://127.0.0.1:%d/" % server.server_address[1]
    channel = os.environ.get("BROWSER_CHANNEL") or None
    failed = 0

    with sync_playwright() as p:
        browser = p.chromium.launch(channel=channel)
        runs = [("recovery", lambda: run_recovery(browser, base))]
        runs += [(label, functools.partial(run_click_test, browser, base,
                                           path, scenario))
                 for label, path, scenario in CLICK_TESTS]
        for label, run in runs:
            try:
                ok, text, errors = run()
            except Exception as err:  # timeouts and navigation failures
                ok, text, errors = False, "", [str(err)]
            failed += not ok
            print(("PASS  " if ok else "FAIL  ") + label)
            if not ok:
                for line in text.strip().splitlines():
                    print("      " + line)
                for err in errors:
                    print("      page error: " + err)
        browser.close()

    server.shutdown()
    print("\n%d of %d test pages passed." % (len(runs) - failed, len(runs)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
