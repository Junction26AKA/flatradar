# FlatRadar team guide

The full plan is in [PLAN.md](PLAN.md), and the shapes we share are in [docs/contracts.md](docs/contracts.md). Deadline: **final submission Sun 15 Nov, 10:00**.

## Setup (everyone)
```bash
git clone https://github.com/Junction26AKA/flatradar.git && cd flatradar
npm install
cp .env.example .env      # ask Adam for CONTEXT_DEV_API_KEY and MONGODB_URI (never commit .env)
npm run smoke             # should print "context.dev ok" and "mongo ok"
```
**Git:** `main` must always work. Work on your own branch (`kevin/…`, `amanda/…`, `adam/…`) and merge through small PRs. Pull `main` often.

**Credits:** we share 50k Context.dev credits. Only Adam's code calls Context.dev. If you need data from it, ask him.

---

## Kevin: the model (`model/`, Python)
**Goal:** given a listing, return a fair price per m² and a deal score that we can defend in front of the judges.

1. **Baselines (start now, no dependencies).** Pull Statistics Finland tables into Mongo collection `baselines`:
   - Sale: `https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi/13mu.px`, € per m² by postcode × room type (one-room, two-room, three-room+, terraced), yearly. Take 2023–2025 for the Helsinki postcodes (`00xxx`).
   - Rent: `https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/asvu/15fa.px`, average rent per m² by area (Helsinki and "Helsinki 1–4") × rooms, quarterly. Map postcodes to the Helsinki 1–4 zones (Statistics Finland documents the mapping).
   - GET returns the metadata. POST a JSON query to get the data.
2. **`/score` service.** `model/serve.py` (FastAPI, port 8000), matching [contracts §2](docs/contracts.md). The first version uses only comparables (Mongo `$geoNear` on `listings`) and the baseline, so it works before any model exists. Test it with `data/fixtures/listing-sale.json`.
3. **Model.** Adam's backfill fills `listings` with roughly 300–600 sale and 300–600 rent listings; he'll post in chat when it lands. `model/train.py`:
   - gradient boosting on log(€/m²), one model per `kind`
   - features: baseline €/m², m², rooms, year, floor and floors total, elevator, plot leased, fee per m², distance to the centre (Senate Square, 60.1695, 24.9525)
   - print the hold-out MAE (mean absolute error) as a percentage and save `model/<kind>.joblib`
4. **Accuracy story for the pitch:** the MAE, a feature-importance chart, and 10 listings checked by hand.

**Done by Sunday:**
- `/score` answers in under 500 ms for both kinds
- the MAE is known
- one slide on how the fair value is computed

Be honest about the method: it's relative to current asking prices plus Statistics Finland's realised postcode prices.

## Amanda: front end and design (`web/`)
**Goal:** a live dashboard that makes the 3-minute demo land. See the demo script in PLAN.md.

You choose the stack. It must build to static files in `web/dist`, which Adam's server will serve at `/`, calling `/api/*` and `/stream` on the same origin. Leaflet is suggested for the map.
1. **Now:** design system, then the feed card and detail view, built on `data/fixtures/*.json`.
   - **Card:** address, district, price or rent, m², rooms, a **deal badge** (`score.deal_pct`; negative = good deal = green), flag chips (with spinners while `status: "pending"`) and "seen 12 s ago".
2. **Live feed:** subscribe to `/stream` ([contracts §5](docs/contracts.md)). `listing.new` adds a card at the top with an animation. `listing.updated` patches it. `listing.price_drop` shows a "price dropped" badge. Until the server exists, use a mock that replays `data/fixtures/sse-sample.txt`.
3. **Detail view:**
   - score breakdown: model vs comparables vs baseline
   - a list of comparable listings with links
   - flags, each with its source quote and link
   - price history
   - a map with the flat and its comparables
4. **Fan-out telemetry drawer:** a live waterfall built from `call.start` and `call.end` events for the selected listing. Draw one bar per call with the endpoint label. Show totals: number of calls, wall-clock time vs the sum of call durations ("fan-out saved X s"), and errors.
5. **Sign-up form** (`POST /api/users`), the **alert email template** (HTML that we'll send through SendGrid), and a nice-looking **mock listing page** for the stage demo.

**Done by Sunday:**
- the dashboard works against the live server
- the drawer works
- the email template is ready
- demo slides: problem → live demo → how it works → MAE

## Deploy (Render free tier)
- `render.yaml` defines one free web service built from `main` (`npm ci`, `node server.mjs`, health check `/api/health`). Pushing to `main` redeploys it.
- **Secrets** are set in the Render dashboard: `CONTEXT_DEV_API_KEY`, `MONGODB_URI`, `PUBLIC_URL` (the `https://….onrender.com` URL), `ADMIN_TOKEN`, and optionally `SENDGRID_*` and `SCORER_URL`.
- **MongoDB Atlas → Network Access** must allow `0.0.0.0/0`, because Render's free tier has no fixed outbound IP.
- **Keeping it awake:** free instances sleep after 15 minutes without requests. Two things keep it up:
  - cron-job.org requests `GET <PUBLIC_URL>/api/health` every 5 minutes
  - the Context.dev monitor on `/mock` runs every 10 minutes
- **After the first deploy, or whenever `PUBLIC_URL` changes**, run `curl -X POST <PUBLIC_URL>/admin/monitors -H "x-admin-token: $ADMIN_TOKEN"`. This creates or re-points the monitors and stores their webhook secrets.
- **Manual diff of a portal:** `curl -X POST <PUBLIC_URL>/admin/poll -H "x-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"portal":"etuovi"}'`.

## Adam: backend and infrastructure
Ingestion (Etuovi for sale, Vuokraovi for rent), batch backfill, monitors and webhooks, enrichment fan-out (parse-document, news, company), flags, Mongo, the API and SSE, user alerts through SendGrid, the mock feed and `run-monitor-now`, and deploy. He'll post in chat when each part works:
- the backfill has landed in `listings`
- the API is live
- the SSE stream is live
- the public URL is up
