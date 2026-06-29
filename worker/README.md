# PAPERTRAIL Worker

This Cloudflare Worker proxies OpenAlex requests for PAPERTRAIL and keeps the OpenAlex API key out of the GitHub Pages frontend.

## Routes

- `GET /health`
- `GET /search-authors`
- `GET /author`
- `GET /works`

The Worker returns normalized JSON and enables CORS for the static frontend.

## Deploy

Install Wrangler if needed:

```powershell
npm install -g wrangler
```

From the `worker/` directory, deploy with the included `wrangler.toml`:

```powershell
wrangler deploy
```

The current configuration uses:

```toml
name = "papertrail-api"
main = "worker.js"
compatibility_date = "2026-06-28"
```

## Set OPENALEX_API_KEY

Never commit secrets. Set the OpenAlex API key as a Cloudflare Worker secret:

```powershell
wrangler secret put OPENALEX_API_KEY
```

The Worker applies authentication in one helper, `applyOpenAlexAuthentication()`. OpenAlex currently accepts an API key through the `api_key` query parameter, so future authentication changes should only require updating that helper.

## Test

After deployment:

```powershell
curl https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/health
```

Expected response:

```json
{"ok":true,"service":"PAPERTRAIL Worker"}
```

## API_BASE_URL

`API_BASE_URL` is defined at the top of `worker.js`:

```js
const API_BASE_URL = "https://api.openalex.org";
```

Update this value only if OpenAlex changes its API base URL or you intentionally route through another compatible service.

OpenAlex request timeout and retry behavior is also centralized near the top of `worker.js`:

```js
const OPENALEX_TIMEOUT_MS = 30000;
const OPENALEX_MAX_ATTEMPTS = 3;
```

The Worker retries transient `429`, `502`, `503`, and `504` responses with short backoff delays.

## CORS

The Worker handles `OPTIONS` requests and sends permissive CORS headers so GitHub Pages can call it from the browser.

## Secrets

Do not place OpenAlex keys in:

- `index.html`
- `app.js`
- `.env` files committed to Git
- GitHub Pages settings visible to the frontend

Use Cloudflare Worker Secrets only.
