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

From the project root, deploy with:

```powershell
wrangler deploy worker/worker.js --name papertrail --compatibility-date 2026-06-27
```

You can also create a `wrangler.toml` if you want stable naming and environment configuration instead of passing those flags.

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

## CORS

The Worker handles `OPTIONS` requests and sends permissive CORS headers so GitHub Pages can call it from the browser.

## Secrets

Do not place OpenAlex keys in:

- `index.html`
- `app.js`
- `.env` files committed to Git
- GitHub Pages settings visible to the frontend

Use Cloudflare Worker Secrets only.
