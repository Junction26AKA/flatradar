# Development and operations

How to run, deploy and look after FlatRadar. The system design is in [architecture.md](architecture.md), and the data, API and SSE shapes are in [contracts.md](contracts.md).

## Setup
```bash
git clone https://github.com/Junction26AKA/flatradar.git && cd flatradar
npm install
cp .env.example .env      # never commit .env
npm run smoke             # should print "context.dev ok" and "mongo ok"
npm run setup-db          # collections and indexes, safe to re-run
```
`.env.example` lists every variable. Only `CONTEXT_DEV_API_KEY` and `MONGODB_URI` are required. Each optional service switches its feature off when its key is missing.

**Web app:** `npm --prefix web install`, then `npm --prefix web run dev` for the Vite dev server, or `npm --prefix web run build` to build into `web/dist`, which `server.mjs` serves at `/`. While the server isn't running, the front end can be built against `data/fixtures/*.json` and the replayed SSE sample `data/fixtures/sse-sample.txt`.

**Model service:** see [model/README.md](../model/README.md). Without `SCORER_URL`, Node uses its own comparables score.

**Git:** `main` must always work, because Render deploys from it. Work on a branch and merge through small PRs.

## Scripts
| Command | What it does | Cost |
|---|---|---|
| `npm run backfill -- --pages 12` | Scrapes search pages, then extracts every listing through the Batch API (`--dry-run` to count first) | Context.dev credits |
| `npm run backfill-photos` | Fetches gallery photos for listings stored before photos were extracted (dry run by default) | 1 credit per listing |
| `npm run enrich-all` | Re-runs rule flags and the score for every extracted listing | none |
| `npm run streetworks-all` | Re-adds street-works flags to every listing | none |
| `npm run insight-all` | Runs the Gemini analyst on listings that don't have an insight yet | Gemini tokens |
| `npm run cloudinary-setup` | Creates the upload preset and checks that AI Vision works | none |
| `npm run test:dedupe` | Tests listing deduplication | none |

## Deploy (Render free tier)
- `render.yaml` defines two free web services, both auto-deployed from `main`:
  - `flatradar`: Node. Runs `npm ci`, builds the web app into `web/dist`, starts `node server.mjs`. Health check `/api/health`.
  - `flatradar-scorer`: Python. Redeployed only when `model/**` changes.
- **Secrets** are set in the Render dashboard, never in the repo:
  - `CONTEXT_DEV_API_KEY`, `MONGODB_URI`
  - `PUBLIC_URL` (the service's `https://….onrender.com` URL)
  - `ADMIN_TOKEN` (**always set this in production**; without it the `/admin/*` routes are open)
  - optional: `SENDGRID_API_KEY`, `SENDGRID_FROM`, `SCORER_URL`, `GEMINI_API_KEY`, `DIGITRANSIT_KEY`, `CLOUDINARY_URL`
- **MongoDB Atlas → Network Access** must allow `0.0.0.0/0`, because Render's free tier has no fixed outbound IP.
- **Keeping it awake:** free instances sleep after 15 minutes without requests. The GitHub Actions workflow `.github/workflows/keepalive.yml` requests `/api/health` every 5 minutes, and `/api/health` pings the scorer, so both stay up. The Context.dev monitor on `/mock` also wakes it every 10 minutes.

## Admin endpoints
Every admin endpoint needs the header `x-admin-token: $ADMIN_TOKEN`.

| Endpoint | When to use it |
|---|---|
| `POST /admin/monitors` | After the first deploy, or whenever `PUBLIC_URL` changes. Creates or re-points the search-page monitors and stores their webhook secrets. |
| `POST /admin/listing-monitors` `{"max": N}` | Creates per-listing monitors for existing listings, up to `max` in total (default `LISTING_MONITOR_MAX`). Saved flats come first. |
| `POST /admin/poll` `{"portal": "etuovi"}` | Diffs one portal's search page now |
| `POST /admin/sweep` `{"pages": N}` | Price sweep over search pages 2–N |
| `POST /admin/photos` `{"id": "<listing id>"}` or `{"limit": N}` | Re-runs the Cloudinary photo pass |

Example: `curl -X POST "$PUBLIC_URL/admin/monitors" -H "x-admin-token: $ADMIN_TOKEN"`.

## Monitoring
**Health:** `GET /api/health` returns the monitors, the time of the last webhook, listing counts, SSE clients and the scorer status. In the daytime `last_webhook_at` should be under about an hour old, and `listings` should grow.

**Credits:** check the Context.dev dashboard. In the daytime, expect roughly 50–150 credits per hour plus 1 per per-listing monitor run. A much higher rate usually means something is looping: look in the `runs` collection for the same ids showing up as changed again and again.

**Monitors:** each one should show `status: active` with no `webhook_failure`. Context.dev pauses a monitor whose webhook keeps failing.

| Symptom | Fix |
|---|---|
| Render instance asleep or restarted | The keepalive and the `/mock` monitor wake it. Half-finished listings are completed automatically on startup. |
| `PUBLIC_URL` changed (new service or domain) | Re-run `POST /admin/monitors` (re-points every monitor and stores new secrets) |
| Webhook 401s in the Render logs | Signing secrets are out of sync: re-run `POST /admin/monitors` |
| Credits draining | Pause the portal monitors in the Context.dev dashboard and look at `runs` |
| Scorer down | Nothing to do: Node falls back to the comparables score |

## Demo flow
`POST /mock/publish` adds a flat to the public `/mock` page and triggers its Context.dev monitor. The webhook then arrives like any real portal's, and the card appears on the dashboard. If no webhook arrives within 40 s, the server diffs `/mock` itself.

To run the demo without internet access for the webhook, run locally with `PUBLIC_URL` empty. The mock flow then uses the local path (no monitor, no PDF), and the card and flags appear in about 1 s.
