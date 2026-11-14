# Contracts

These are the shapes the three parts agree on. If you need to change one, say so in chat first.

Owners: the listing document, the API and SSE belong to Adam. `/score` and the `score` object belong to Kevin. Amanda only reads, so none are hers.

Sample data is in `data/fixtures/`. Any numbers in a `score` there are made up, for layout only.

## 1. `listing` (Mongo collection `listings`)
```jsonc
{
  "_id": "etuovi:20828740",          // "<portal>:<portal id>"
  "portal": "etuovi" | "vuokraovi" | "mock",
  "kind": "sale" | "rent",
  "url": "https://www.etuovi.com/kohde/20828740",
  "address": "Wavulinintie 5, Helsinki", "postcode": "00210", "district": "Lauttasaari",
  "loc": { "type": "Point", "coordinates": [24.8773, 60.1539] },   // [lng, lat], 2dsphere index
  "building_type": "Kerrostalo", "rooms": 2, "rooms_description": "2h + kt + kph",
  "m2": 49.5, "year": 1972, "floor": 1, "floors_total": 6,
  "elevator": true, "sauna": true, "balcony": true, "condition": "Hyvä",
  "plot": "own" | "leased" | null, "energy_class": "E (2018)",
  "tenure": "ownership" | "right_of_occupancy" | "part_ownership" | "hitas" | null,
  "comparable": true,                 // false = deposit price (asumisoikeus), €0 enforcement sale or €/m² outlier.
                                      // Train, score and pick comparables ONLY from comparable: true.
  // sale only (null for rent)
  "price": 329000, "debt_free_price": 329000, "debt_share": null,
  "fee_month": 198, "fee_m2": 4.0, "housing_company": "Asunto Oy …",
  // rent only (null for sale)
  "rent": null, "available_from": null,
  "agent_company": "Vauramo LKV",
  "renovations_done": "free text (Finnish)", "renovations_upcoming": "free text (Finnish)",
  "attachments": [{ "title": "Isännöitsijäntodistus", "url": "https://…pdf" }],
  "first_seen_at": "ISO date", "last_seen_at": "ISO date",
  "price_history": [{ "at": "ISO date", "price": 329000, "debt_free_price": 329000, "rent": null }],
  "score": Score | null,              // §2, filled in by Kevin's /score
  "flags": [Flag],                    // §3, filled in by Adam's enrichment; grows as calls return
  "status": "new" | "enriching" | "ready"
}
```
The price per m² that everything compares on is `debt_free_price / m2` for a sale and `rent / m2` (per month) for a rental.

## 2. `/score` (Kevin, Python, `POST http://localhost:8000/score`)
The request body is a `listing` (with or without `score` and `flags`). The response is a `Score`:
```jsonc
{
  "fair_m2": 6150,            // € per m² (sale, debt-free) or € per m² per month (rent)
  "fair_price": 304425,       // fair_m2 × m2 (rent: € per month)
  "deal_pct": 0.081,          // (asking − fair) / fair. Negative = cheaper than fair = good deal
  "confidence": "low" | "medium" | "high",
  "model":    { "fair_m2": 6050, "version": "gbr-v1", "mae_pct": 0.11 },     // null if no model yet
  "comps":    { "fair_m2": 6300, "n": 9, "radius_m": 1000,
                "items": [{ "id": "etuovi:…", "url": "…", "address": "…", "m2": 52, "rooms": 2,
                            "year": 1970, "price_m2": 6280, "distance_m": 340 }] },
  "baseline": { "source": "Statistics Finland 13mu", "postcode": "00210", "room_type": "two-room",
                "year": 2025, "eur_m2": 5980 },
  "yield_pct": 0.046,         // sale only: estimated rent × 12 / debt_free_price. null for rent
  "scored_at": "ISO date"
}
```
- Must answer in under 500 ms. Comparables come from Mongo `listings` (`$geoNear`, same `kind`).
- If the model isn't trained yet, return `model: null` and use comparables plus the baseline.

## 3. `Flag`
```jsonc
{
  "id": "f_ab12",
  "type": "renovation_upcoming" | "pipe_renovation" | "facade_balcony" | "company_loan" | "leased_plot"
        | "high_fee" | "street_works" | "news" | "landlord" | "commute",
  "severity": "info" | "warn" | "high",
  "label": "Facade + balcony renovation 2027",       // short, English, shown on the chip
  "detail": "Works start 11–12/2026, 6 months.",       // one or two sentences
  "est_cost_eur": 18000,       // nullable; this flat's estimated share
  "year": 2027,                // nullable
  "source": { "kind": "listing" | "pdf" | "news" | "open_data", "url": "…", "quote": "2027 Parvekkeet ja julkisivu…", "page": null },
  "status": "ok" | "pending" | "error"   // pending = call still running (show a spinner chip)
}
```

## 4. HTTP API (Adam, Node, same origin as the web app)
| Method + path | Returns |
|---|---|
| `GET /api/listings?kind=sale\|rent&limit=50` | `{ items: [listing] }`, newest `first_seen_at` first |
| `GET /api/listings/:id` | `listing` + `calls: [CallEnd]` (the fan-out of its last enrichment) |
| `POST /api/users` `{ email, name, searches: [{ kind, max_price, min_rooms, postcodes: [], min_deal }] }` | `{ id }` |
| `POST /mock/publish` `{ preset?: "kallio-2h" }` | `{ listing_id }` and starts the demo flow |
| `GET /api/health` | `{ ok, monitors, last_webhook_at, credits_remaining }` |
| `GET /stream` | Server-Sent Events, see §5 |

## 5. SSE events (`GET /stream`)
Each message has `event: <type>` and `data: <json>`. A sample stream is in `data/fixtures/sse-sample.txt`.

| event | data |
|---|---|
| `hello` | `{ server_time }` |
| `listing.new` | `{ listing }`: a card appears (score and flags may be empty or pending) |
| `listing.updated` | `{ id, patch }`: merge `patch` into the listing (e.g. `{ score }`, `{ flags }`, `{ status }`) |
| `listing.price_drop` | `{ id, old_price, new_price, at }` |
| `call.start` | `{ id, listing_id, endpoint, label, queued_at, started_at }` |
| `call.end` | `{ id, listing_id, endpoint, label, started_at, ms, status: "ok"\|"error", request_id }` |
| `alert.sent` | `{ listing_id, to: "a***@gmail.com", at }` |
