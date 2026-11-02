# orbita

A personal productivity space with a dashboard, notes, to dos, focus timer, timekeeper and R codepad.

Open the app at [ecologibel.github.io/orbita](https://ecologibel.github.io/orbita/). For instructions on using its tools and syncing with Google Drive, open **help** from the sidebar.

## Development

The app is a static site built with HTML, CSS and JavaScript. To preview it locally, serve the repository root over HTTP, for example:

```sh
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

The timekeeper connects to Google Calendar with read-only access. It stores its
own OAuth token separately from Google Drive sync, so it can use a different
Google account. The Google Calendar API is enabled and the OAuth client already
allows `https://ecologibel.github.io`, `http://localhost:8000`, and
`http://localhost:8001` as JavaScript origins. Calendar tags and date preferences
stay in this browser.

## Licence

[MIT](LICENSE)
