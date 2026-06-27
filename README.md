# PAPERTRAIL

[PAPERTRAIL GitHub Pages](https://4l3xv33.github.io/PAPERTRAIL/)

PAPERTRAIL is a lightweight research collaboration explorer for careful bibliometric triage. It helps users search for researchers, retrieve publication metadata through OpenAlex, explore scholarly collaboration patterns, cache results in the browser, and generate a careful analyst memo.

PAPERTRAIL does not determine misconduct, foreign influence, technology transfer, or security risk. It supports careful exploration of scholarly footprints and collaboration patterns that require context.

## Architecture

- Frontend: GitHub Pages, HTML, CSS, and vanilla JavaScript.
- Backend: Cloudflare Worker proxy.
- Data source: OpenAlex through the Worker.
- Cache: IndexedDB in the user's browser.
- No React, Vue, Svelte, TypeScript, Tailwind, bundler, server-side database, login, user accounts, or server-side tracking.

## Project Structure

```text
PAPERTRAIL/
  index.html
  styles.css
  app.js
  README.md
  ROADMAP.md
  vendors/
  worker/
    worker.js
    README.md
```

## Local Use

Because IndexedDB and browser fetch behavior are more reliable from a local server than from direct file loading, run any small static server from the project root. Common options include:

```powershell
python -m http.server 8080
```

or:

```powershell
npx serve .
```

Open `http://localhost:8080`.

Configure the Worker URL in the browser console:

```js
localStorage.setItem("papertrail_worker_url", "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev");
location.reload();
```

For a committed deployment, set `window.PAPERTRAIL_WORKER_URL` before `app.js` loads in `index.html`, or keep using the browser-local setting.

## GitHub Pages Deployment

1. Push this repository to GitHub.
2. In repository settings, enable GitHub Pages from the main branch root.
3. Deploy the Cloudflare Worker separately.
4. Configure the deployed Worker URL for the GitHub Pages site.

The frontend never contains the OpenAlex API key.

## Cloudflare Worker Deployment

See [worker/README.md](worker/README.md).

## Browser Cache

PAPERTRAIL stores only browser-local cache entries in IndexedDB:

- Searches: suggested TTL 7 days.
- Author profiles: suggested TTL 30 days.
- Works: suggested TTL 30 days.

Before requesting fresh data, PAPERTRAIL checks the cache. Selecting "Bypass local cache / Refresh from source" ignores cached data, fetches current data through the Worker, and replaces the cached record. "Clear Local Cache" removes cached searches, author profiles, and works from the browser.

## Privacy

- No login.
- No user accounts.
- No backend database.
- No server-side tracking.
- Only browser-local caching.
- OpenAlex requests go through the Cloudflare Worker so secrets stay off GitHub Pages.

## Provider Abstraction

The frontend uses:

- `researchProvider.searchAuthors()`
- `researchProvider.getAuthor()`
- `researchProvider.getWorksByAuthor()`

This keeps OpenAlex-specific routing behind a small interface so future providers such as ORCID, Crossref, Semantic Scholar, or PubMed can be added without redesigning the application.

## Interpretation

Signal Density is a transparent bibliometric heuristic. It is NOT a risk score.

PAPERTRAIL always treats bibliometric indicators as requiring context. Co-authorship is not proof of direct collaboration, large author lists can distort inferred relationships, and metadata may contain incomplete affiliations or errors.
