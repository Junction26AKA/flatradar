# Plan: FlatRadar Helsinki (buy + rent) — fresh build, ~30 h

> **This is the plan we wrote at the start of the hackathon (Sat 14 Nov 2026), kept as a record.** Some things changed while we built it. For example, street works come from the City of Helsinki permit register rather than news search, and Oikotie was added later. The current design is in [docs/architecture.md](docs/architecture.md).

## Context
**Product:** watch Helsinki flats for sale and for rent on the live web. When a listing appears or its price drops,
score it in seconds:
- **Deal score:** asking price vs our estimate of fair price/rent, with comparable listings shown.
- **Hidden costs:** upcoming renovations and housing company debt, parsed from listing documents.
- **Neighbourhood red flags:** street works and local news.

Then alert matching users by email and on a live dashboard.

The demo moment: we publish a flat on a mock listing page and trigger the Context.dev monitor on stage. A scored card appears within ~20 s and the email lands on a phone.

Decisions made: both buy and rent, Helsinki, a fresh repo. Judging is 5 × 20%: impact, creative use of live web data, demo completeness, technical execution (latency and accuracy), real-timeness.

## Step 0: first hour (blocking)
1. **Feasibility, ~30 credits.** Scrape with Context.dev and structured extraction:
   - Oikotie sale search (Helsinki, newest first), Oikotie rent search, Etuovi and Vuokraovi search pages
   - one listing page from each portal
   Confirm we get price, debt-free price (velaton hinta), m², rooms, build year, floor, address and postcode, maintenance fee (hoitovastike), plot (own or leased), "done / upcoming renovations" text, attachment PDF links, and coordinates if present.
   Pick the **two portals that work** (one for sale, one for rent). If both block us, use the mock feed plus whatever we can backfill.
2. **Accounts:** a SendGrid trial with a verified single sender, and a Digitransit API key (geocoding plus the HSL commute stretch goal). Check what remains on the Context.dev monitor quota (`get-monitor-limits`).
3. **Statistics Finland PxWeb:** find the tables for *prices of old dwellings by postal code* and *rents by postal code* (free JSON API, no Context.dev).

### Step 0 results (Sat 14 Nov, 02:20)
- **Credits:** 50,484 left. **Monitors:** 0 of 10 used (free plan).
- **Sale portal = Etuovi.** The search page `https://www.etuovi.com/myytavat-asunnot/helsinki?jarjestys=uusimmat` scrapes cleanly as markdown. Each card has address, district, building type, year, rooms, floor, price, m² and a "Uusi 24 h" (new) tag. Listing URLs look like `https://www.etuovi.com/kohde/<id>`.
- **One JSON extraction of a listing** (`kohde/20828740`) returned every field: postcode, coordinates, price and debt-free price, maintenance fee, plot, energy class, housing company, agent, and full done/planned renovation text (e.g. "2027 Parvekkeet ja julkisivu, works start 11/12 2026"). `attachments` came back empty, so the renovation text is the main hidden-cost source and PDFs are a bonus.
- **Rent portal = Vuokraovi.** Same Alma Media platform as Etuovi. `https://www.vuokraovi.com/vuokra-asunnot/helsinki?jarjestys=uusimmat` works, but it redirects and adds a `&haku=` session parameter, so check that a monitor on it stays stable. Cards have type, rooms, address, rent €/month, m², year and availability.
- **Oikotie:** the search page loads, but the listings sit beyond the compact-mode clip and weren't checked. We're not using it; Etuovi and Vuokraovi are enough.
- **Statistics Finland (PxWeb, free):**
  - **Sale baseline:** `https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi/13mu.px`, €/m² and number of sales by postcode × (1-room, 2-room, 3-room+ flat; terraced), yearly 2009–2025.
  - **Rent baseline:** `.../StatFin/asvu/15fa.px`, average rent €/m² by area (includes Helsinki and its zones "Helsinki 1–4") × funding × rooms, quarterly 2025Q1–2026Q3.

## Architecture
```
Context.dev monitors (≤10) on portal search pages + our /mock page ──webhook──▶ Node service
  POST /webhooks/context → verify signature → diff search results by listing id → new / price_drop
  → scrape listing (structured extraction) → geocode → parse PDFs → red flags → score → Mongo
  → change stream on `events` → SSE /stream → dashboard;  matcher → SendGrid email
Python scorer (FastAPI /score) ← model trained on backfilled listings + Statistics Finland baselines
MongoDB Atlas: users, listings (2dsphere, price history), events, documents, baselines
```
- Small wrappers: one Context.dev client in `lib/context.mjs`, one Mongo client in `lib/db.mjs`, `.env` with `CONTEXT_DEV_API_KEY`, `MONGODB_URI`, `MONGODB_DB=flatradar`, `SENDGRID_API_KEY`, `DIGITRANSIT_KEY`.
- Node for ingestion, API and SSE, plus a small Python sidecar only for the model. If the model isn't ready in time, we ship the comparables score alone (see below).
- Public URL for webhooks: cloudflared while developing, then deploy (Render or Railway). The service must be long-running because change streams and SSE need a persistent connection.

## Components
**1. Ingestion (`lib/ingest/`)**
- `extract.mjs`: one JSON schema per portal page type → a normalised `listing` document `{_id: portal:id, kind: sale|rent, url, address, postcode, loc, m2, rooms, year, floor, elevator, plot, price, debt_free_price, rent, fee_m2, renovations_done, renovations_upcoming, attachments[], seen_at, price_history[]}`. Cache raw responses in `.cache/`.
- `backfill.mjs`: map or crawl search result pages and send ~300–600 listings per kind through the **Batch API**, to get training data and comparables. This uses the "Scale" part of the API. Budget ~3k credits.
- `geocode.mjs`: use coordinates from the page if present, otherwise Digitransit geocoding.
- **Monitors:** 2 portals × (sale, rent) = 4 search-page monitors, plus 1 on our mock page, plus spares. Diff each search page against what we've stored, so the same monitor gives us both new listings and price drops.

**2. Fair value (`lib/score/` + `model/`)**
- **Comparables:** a Mongo `$geoNear` query on `listings` for the same kind, ±25% m², similar rooms and build-year band, within 1 km → median €/m². These are shown in the UI as linked comparable listings.
- **Model:** `model/train.py` trains gradient boosting on log(€/m²).
  - Features: Statistics Finland postcode baseline, m², rooms, year, floor, elevator, plot leased, fee/m², distance to the centre.
  - Separate sale and rent models.
  - Report the hold-out MAE (mean absolute error) in the pitch.
  - Served by `model/serve.py` (FastAPI `/score`).
- **Deal score:** a blend of the model and comparables → "−14% vs fair value", with a confidence level.
- For sales, also show the rental yield: estimated rent ÷ debt-free price.
- In the pitch, be honest that this is relative to current asking prices plus Statistics Finland's realised postcode prices.

**3. Hidden costs and red flags (`lib/flags/`)**
- `documents.mjs`: run `parse-document` on attachment PDFs (sales brochure, isännöitsijäntodistus); if there are none, use the listing's renovation text. LLM extraction → flags such as upcoming pipe renovation (putkiremontti) with year and €/m² estimate, a large housing company loan, leased plot, high maintenance fee. Each flag keeps its source URL and the page or quote it came from.
- `neighbourhood.mjs`: Context.dev news search on street plus district plus construction terms. Stretch goals: Helsinki street-works open data near the flat; HSL commute time to a user-set address (Digitransit).
- Rentals listed by a company: Context.dev company search/enrich plus news on the landlord (stretch).

**4. Users and alerts (`lib/alerts/`)**
- `users`: `{email, name, searches: [{kind, max_price, min_rooms, postcodes[], min_deal}]}`, with a simple sign-up form.
- On each `new` or `price_drop` event: match saved searches → SendGrid email (score, top flags, link), and record it in `events.alerts_sent`.

**4b. Parallel enrichment and the "Context fan-out" telemetry drawer**
- When a listing triggers, the enrichment runs in parallel with `Promise.allSettled`, not one call after another:
  - scrape and extract the listing
  - parse-document on each attachment
  - news searches (street, district, construction terms, landlord)
  - company search/enrich for rental landlords
  - geocode, plus commute as a stretch goal

  Comparables and `/score` run as soon as extraction returns. Each branch is optional, so a slow or failed call adds a "pending" flag instead of blocking the card. The card renders first and flags stream in after.
- A shared concurrency limiter in `lib/context.mjs` (p-limit) caps this at ~30. The batch backfill and monitors get the rest of the 50-request quota, so a 429 can't break the demo.
- `lib/context.mjs` wraps every call and writes `{listing_id, endpoint, started_at, ms, status, credits, request_id}` to `calls`. These are pushed over SSE as `call.start` / `call.end` events.
- **The UI drawer (Amanda)** shows a live waterfall per listing: one bar per request, labelled by endpoint, showing when it started, how long it took and whether it succeeded. Totals: number of calls, wall-clock time vs the sum of call times ("fan-out saved X s"), and credits spent.
- **Show measured numbers only.** We quote whatever the rehearsal measures, and don't promise a figure in advance.
- Demo script step 3: open the drawer while the mock flat is processed.

**5. API and dashboard**
- Endpoints: `GET /api/listings?kind=`, `GET /api/listings/:id` (score breakdown, comparables, flags with sources, price history), `GET /stream` (SSE), `POST /api/users`, `POST /mock/publish` (adds a flat to `/mock` and calls `run-monitor-now`).
- One page with a live feed of cards (deal-score badge, flag chips, "seen X s ago"), a detail drawer, a map (Leaflet), and a sign-up form.

## Demo script (3 min)
1. Show the dashboard: real listings from the weekend, with scores and flags.
2. Sign up with a phone email for "2-room flats under €280k in Kallio".
3. Press "publish" on the mock flat. This triggers the monitor and its webhook, and a card appears with "−18% vs fair value", "⚠ pipe renovation planned 2027 (≈€45k for this flat)" from the parsed PDF, and a nearby street-works news flag.
4. The email arrives on the phone.
5. Close on the Context.dev calls used and the model's MAE.

## Timeline and split (Sat → Sun 10:00), 3 people
- **Adam:** the heavy technical work. Ingestion, Context.dev (extraction, batch, monitors, webhooks, parse-document, news), the Node service, Mongo, the change stream and SSE, alert matching, deploy.
- **Amanda:** front end and design. Dashboard, cards, detail view, map, sign-up, the email template, demo visuals and slides.
- **Kevin:** the model. Statistics Finland baselines, features, training and MAE, the `/score` service, the comparables blend and deal score.

| Hours | Adam (backend/infra) | Kevin (model) | Amanda (front end/design) |
|---|---|---|---|
| 0–2 | Step 0 feasibility, repo scaffold, `.env`, SendGrid sender | Statistics Finland PxWeb pulls (sale and rent by postcode) → `baselines` | design system, card and detail wireframes, against a mock `listing` JSON |
| 2–10 | extraction schemas + normalise, backfill via batch, geocode → `listings`; publish the `listing` schema to Kevin and Amanda | features from `listings`, train v1 (sale + rent), hold-out MAE | dashboard skeleton on fixture data, SSE client |
| 10–18 | monitors + webhook + diffing, parse-document + flag extraction, news flags, users + matcher + email send | `/score` FastAPI, comparables `$geoNear` blend → deal score + confidence, yield | wire to the real API, detail view (score breakdown, comparables, flags with sources), sign-up form, email template |
| 18–24 | deploy (public URL), `/mock` + `POST /mock/publish` → `run-monitor-now`, end-to-end test | model v2, spot-check 10 listings, MAE + feature-importance slide | map (Leaflet), polish, live "new listing" animation, mock flat page design |
| 24–30 | buffer · rehearse demo together · record video · write submission | | |

**Interfaces to agree in hour 0:**
- the `listing` document shape: Adam owns it
- `POST /score {listing} → {fair_m2, deal_pct, confidence, comps[]}`: Kevin owns it
- the `/api/*` and SSE event shapes: Adam owns them, and Amanda builds against fixtures until they're live

## Verification
- `npm run smoke`: Context.dev and Mongo connectivity. A fixture test that `extract` normalises one cached page per portal.
- Model: hold-out MAE printed by `train.py`. Spot-check 10 listings by hand.
- End to end on the deployed URL:
  - sign up
  - `POST /mock/publish` → webhook received (check `list-webhook-deliveries`) → listing stored and scored → SSE card in < 30 s → email received
- A real portal monitor fires at least once overnight, and we keep the event as proof.
- Check `get-usage` before and after the backfill to confirm the credit budget.
