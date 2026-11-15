# FlatRadar

**Watches Helsinki flat listings live. Seconds after a flat appears or drops in price, FlatRadar scores it against fair value and flags hidden renovation costs, in English and Finnish.**

Built in one weekend at **Junction 2026** for the Context.dev challenge, *The Web Is Your Real-Time Database*.

**Live demo:** https://flatradar-u7ei.onrender.com. It runs on Render's free tier, so the first load can take up to a minute while the service wakes up.

---

## The problem
Finding a flat in Helsinki means refreshing Etuovi and Vuokraovi all day, guessing whether the price is fair, and digging through Finnish housing-company documents for renovations that can add tens of thousands of euros. Good flats go in days.

## What FlatRadar does
FlatRadar watches flats for sale (Etuovi, Oikotie) and for rent (Vuokraovi, Oikotie). Within seconds of a listing appearing or changing price, it:

- **Scores the asking price** against fair value. The fair price blends a gradient-boosting model, nearby comparable listings and Statistics Finland postcode prices, and shows a confidence level.
- **Flags hidden costs:** planned pipe or facade renovations with a cost estimate for this flat, housing-company loans, leased plots and high fees. Each flag shows the quote and the document it came from.
- **Flags neighbourhood risks:** major street works within 150 m, from the City of Helsinki permit register.
- **Explains the listing** in plain English and Finnish, with questions to ask the agent (Gemini). Every cost Gemini cites must quote the source word for word, and the code sets the euro amount, never the model.
- **Reads the photos** (Cloudinary AI Vision): dated kitchens, worn floors and damp become costed photo flags. A "See it renovated" slider shows the room after a generative edit.
- **Alerts people** whose saved search matches by email, and streams the card to the live dashboard.

## How it works
```
Portal search pages ─┐                         ┌─▶ scorer (Python, gradient boosting)
One page per flat ───┼─ Context.dev monitors ──▶ Node service ─┼─▶ PDF parsing, street works, rule flags
/mock demo page ─────┘     (signed webhooks)     │             └─▶ Gemini analyst (after the card is ready)
                                                 ├─▶ MongoDB Atlas
                                                 ├─▶ SSE ─▶ React dashboard
                                                 └─▶ SendGrid alert emails
```
1. Context.dev **monitors** watch the portal search pages and every tracked listing page, and call our webhook when something changes.
2. The server diffs the search page against stored listings to find new flats and price changes, then extracts each listing as structured JSON.
3. **Enrichment runs in parallel:** score, street works and PDF flags. Every external call is timed and shown as a per-listing waterfall in the app.
4. When the card is ready, matching users get an email and the dashboard updates over server-sent events. Gemini's analysis fills in a few seconds later.

Diagrams and details are in [docs/architecture.md](docs/architecture.md).

## Results from the weekend
- **Real-time:** the median time from a new search card to a fully scored and flagged listing was **9.7 s**, measured on 90 live listings. We tracked over 760 listings, each with its own Context.dev monitor that catches price drops and sold flats.
- **Accuracy:** fair-value error (5-fold, out of fold, on real listings) was **13.2%** for sales (53% within 10%) and **8.4%** for rentals (70% within 10%). The method is in [model/README.md](model/README.md).
- **Grounded AI:** across all listings, Gemini found 294 extra renovation items. 17 claims were rejected because the quote wasn't in the source.

## Tech stack
| Part | Built with |
|---|---|
| Live web data | **Context.dev**: monitors + webhooks, scrape (markdown and JSON-schema extraction), PDF parsing, batch backfill |
| Backend | Node 22 (no framework): ingestion, REST API, server-sent events, alerts |
| Fair value | Python, FastAPI, scikit-learn (`HistGradientBoostingRegressor`), Statistics Finland PxWeb |
| Data | **MongoDB Atlas**: listings with price history, `$geoNear` comparables on a 2dsphere index, telemetry |
| AI analyst | **Gemini API**: bilingual verdict, grounded hidden-cost extraction |
| Photos | **Cloudinary**: AI Vision tagging, generative replace, smart-cropped share cards, Upload Widget. See [docs/cloudinary.md](docs/cloudinary.md) |
| Front end | React 19, Vite, TypeScript, Leaflet; EN/FI switch |
| Email, hosting | SendGrid, Render (two free services), GitHub Actions keepalive |

## Run it locally
You need Node 22.12+, a MongoDB Atlas cluster and a Context.dev API key. Python 3.12 is optional and only needed for the model.

```bash
git clone https://github.com/Junction26AKA/flatradar.git && cd flatradar
npm install
cp .env.example .env        # fill in CONTEXT_DEV_API_KEY and MONGODB_URI at least
npm run smoke               # checks the Context.dev and MongoDB connections
npm run setup-db            # creates the collections and indexes
npm --prefix web install && npm --prefix web run build
npm start                   # http://127.0.0.1:3000
```
All other services are optional, and each feature switches off cleanly without its key: `SCORER_URL` (the Python model; without it the comparables score is used), `GEMINI_API_KEY`, `CLOUDINARY_URL`, `SENDGRID_API_KEY`, `DIGITRANSIT_KEY` (HSL commute times). Setting up the model service is covered in [model/README.md](model/README.md). Deployment, admin endpoints and operations are covered in [docs/development.md](docs/development.md).

## Repository layout
| Path | What's in it |
|---|---|
| `server.mjs` | HTTP server: API, webhooks, SSE, `/mock` demo page, static web app |
| `lib/` | Ingestion, monitors, enrichment, scoring fallback, flags, Gemini analyst, Cloudinary media, alerts |
| `model/` | Statistics Finland baselines, training, and the FastAPI `/score` service |
| `web/` | React dashboard |
| `scripts/` | Backfill, re-enrichment, setup and smoke tests |
| `docs/` | Architecture, data contracts, Cloudinary, development guide |
| `data/fixtures/` | Sample listings and SSE events used for front-end development |

## Team
- **Adam Marshall** ([@amars2005](https://github.com/amars2005)): backend and infrastructure (ingestion, Context.dev, enrichment, API, alerts, deploy)
- **Kevin Hapuhettige Don** ([@kevindon11](https://github.com/kevindon11)): fair-value model and scorer
- **Amanda Hapuhettige Don** ([@ah3324](https://github.com/ah3324), [@amandahdon](https://github.com/amandahdon)): front end and design

## Notes
- "Fair" is relative to current asking prices plus Statistics Finland's realised postcode prices. We don't have transaction prices for individual flats.
- Listing data and photos belong to the portals and agents. We store copies only to run the analysis for this demo.
