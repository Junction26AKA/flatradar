# model/: fair value and deal score

```bash
pip install -r model/requirements.txt
python model/baselines.py        # Statistics Finland → model/data/baselines.json (+ Mongo `baselines` if MONGODB_URI is set)
python model/train.py            # listings from Mongo → model/sale.joblib, model/rent.joblib, model/report.json
python -m uvicorn serve:app --app-dir model --port 8000
curl -X POST localhost:8000/score -H 'content-type: application/json' --data-binary @data/fixtures/listing-sale.json
```
Set `SCORER_URL=http://localhost:8000` for the Node server to use it. Without it, Node falls back to comparables only.

**Deploy (Render, second free web service, see `render.yaml` → `flatradar-scorer`):** build `pip install -r model/requirements.txt`,
start `python -m uvicorn serve:app --app-dir model --host 0.0.0.0 --port $PORT`, health check `/health`,
env `PYTHON_VERSION=3.12.16`, `MONGODB_URI`, `MONGODB_DB=flatradar`. Then set `SCORER_URL` on the Node service to its URL.
The keepalive pings Node's `/api/health`, which pings the scorer, so both stay awake. After retraining, commit the
`.joblib` files and `report.json`; Render redeploys the scorer from `main`.

## How a fair price is computed
1. **Baseline.** The Statistics Finland realised €/m² for the postcode × room type (13mu, 2025; thin cells use an n-weighted mean of 2023–2025). For rent: average €/m² of new non-subsidised contracts by Helsinki rent zone 1–4 × rooms (15fa, latest quarter).
2. **Model.** Gradient boosting (`HistGradientBoostingRegressor`), one per kind, predicting log(€/m²). `train.py` tries both an absolute target and a residual on top of the baseline and keeps whichever cross-validates better; currently that's absolute for both kinds. Listings the model was trained on are scored with their out-of-fold estimate, so backfilled listings aren't scored by a model that has already seen their price. Features are in `common.FEATURES`: both baselines, m², rooms, year, floor, top floor, elevator, sauna, balcony, building type, leased plot, fee/m², condition, distance to Senate Square, lat/lng.
3. **Comparables.** Median €/m² of up to 12 listings of the same kind within 1 km (2.5 km if fewer than 4), ±25% m², ±15 build years, same building type. This is the same query as `lib/score`.
4. **Blend.** `fair = w·model + (1−w)·comps`, with `w` fitted on out-of-fold predictions in `train.py`. If pieces are missing it degrades in this order: model, comps, baseline × asking/realised calibration. The response's `method` field says which one was used.
5. **Deal.** `deal_pct = (asking − fair) / fair`. Negative means cheaper than fair.
6. **Confidence.** `high` when the model and ≥5 comps agree within 10% and the gap is ≤25%. `medium` when they agree within 20%. Otherwise `low`, and always `low` for Hitas, right-of-occupancy and part-ownership.
7. **Yield (sale).** The rent model's €/m² for the same flat × m² × 12 / debt-free price.

**Honest caveat for the pitch:** "fair" is relative to current *asking* prices plus Statistics Finland's *realised* postcode prices. We don't have transaction prices for individual flats.

`train.py` prints and saves (`report.json`) the out-of-fold MAE for baseline vs comps vs model vs blend, the permutation feature importance, and 10 random listings for the hand check.
