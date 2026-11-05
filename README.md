# orbita

A personal productivity space with a dashboard, notes, to dos, focus timer, timekeeper and R codepad.

Open the app at [ecologibel.github.io/orbita](https://ecologibel.github.io/orbita/). For instructions on using its tools and syncing with Google Drive, open **help** from the sidebar.

## Development

The app is a static site built with HTML, CSS and JavaScript. To preview it locally, serve the repository root over HTTP, for example:

```sh
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

The site's `index.html` is an app shell: it stays open and shows each tool in a
frame, so focus ambience keeps playing as you move between tools. The address
follows the tool, e.g. `#notes` or `#to-dos/simple`. A tool page opened on its
own reopens inside the shell; add `?standalone` to its address to open it alone.

The timekeeper connects to Google Calendar with read-only access. It stores its
own OAuth token separately from Google Drive sync, so it can use a different
Google account. The Google Calendar API is enabled and the OAuth client already
allows `https://ecologibel.github.io`, `http://localhost:8000`, and
`http://localhost:8001` as JavaScript origins. Timekeeper's tags, colours and
calendar choices sync through the site's Google Drive sign-in (`timekeeper.json`),
not the Calendar account; its sidebar layout stays in this browser.

### Tests

The pages in `tests/` run in a browser with fake Drive responses. GitHub Actions
runs them on every pull request. To run them all headlessly on your own machine:

```sh
pip install playwright
python -m playwright install chromium
python tests/run_browser_tests.py
```

`tests/drive-concurrency-probe.html` is not included, because it needs a real
Google sign-in.

### Security headers

GitHub Pages can't send custom headers, so each page sets a
Content-Security-Policy in a `<meta>` tag near the top. It allows the app's own
files, Google sign-in, the Google Drive and Calendar APIs, Google Fonts and the
CodeMirror files on cdnjs. When adding a script, stylesheet, font or API from
another site, add it to the policy on every page that uses it, and give CDN
files an `integrity` hash (cdnjs lists one for each file).

## Licence

[MIT](LICENSE)
