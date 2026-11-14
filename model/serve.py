"""FlatRadar /score service (contracts §2).

  python -m uvicorn serve:app --app-dir model --port 8000

POST /score  body: a listing  ->  Score
GET  /health                  ->  which models are loaded, their MAE

Fair value = w x model + (1 - w) x comparables median, with w fitted in train.py. If a piece is missing the
service degrades instead of failing: model only -> comps only -> Statistics Finland baseline.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone

import joblib
import numpy as np
from fastapi import Body, FastAPI, HTTPException

from common import FEATURES, MODEL_DIR, features, get_db, price_m2, rent_baseline, sale_baseline

app = FastAPI(title="FlatRadar scorer")
MODELS: dict = {}


def load_models():
    MODELS.clear()
    for kind in ("sale", "rent"):
        p = MODEL_DIR / f"{kind}.joblib"
        if p.exists():
            art = joblib.load(p)
            assert art["features"] == FEATURES, f"{p.name} was trained on other features; retrain"
            MODELS[kind] = art


load_models()


@app.on_event("startup")
def warm_up():
    """Open the Mongo connection now: the first DNS + TLS handshake to Atlas takes seconds, and Node's
    scorer timeout is 3 s, so a cold first /score would otherwise silently fall back to Node's comps."""
    db = get_db()
    if db is not None:
        try:
            db.command("ping")
        except Exception as e:
            print("mongo warm-up failed:", e)


def r2(x):
    return None if x is None else round(float(x), 2)


# --- pieces ---------------------------------------------------------------------------------------------------
def model_estimate(listing, kind):
    art = MODELS.get(kind)
    if not art:
        return None
    oof = art.get("oof_m2", {}).get(str(listing.get("_id")))
    if oof is not None:  # listing was in the training set: use the estimate from the fold that didn't see it
        return oof
    x = np.array([[features(listing)[f] for f in FEATURES]], dtype=float)
    pred = float(art["model"].predict(x[:, art["cols"]])[0])
    if art["target"] == "residual":
        base = x[0, art["base_col"]]
        pred += art["fallback_log_base"] if math.isnan(base) else base
    return math.exp(pred)


def comparables(listing, radius=1000, max_n=12):
    """Same query as lib/score/index.mjs so the UI's comps and the score agree."""
    db = get_db()
    if db is None or not listing.get("loc") or not listing.get("m2"):
        return None
    kind, m2 = listing.get("kind"), float(listing["m2"])
    query = {
        "_id": {"$ne": listing.get("_id")},
        "kind": kind,
        "comparable": True,
        "portal": {"$ne": "mock"},  # demo flats must never become anyone's comparable
        "m2": {"$gte": m2 * 0.75, "$lte": m2 * 1.25},
        **({"debt_free_price": {"$gt": 0}} if kind == "sale" else {"rent": {"$gt": 0}}),
        **({"building_type": listing["building_type"]} if listing.get("building_type") else {}),
        **({"year": {"$gte": listing["year"] - 15, "$lte": listing["year"] + 15}} if listing.get("year") else {}),
    }
    proj = {"url": 1, "address": 1, "m2": 1, "rooms": 1, "year": 1, "debt_free_price": 1, "price": 1, "rent": 1,
            "kind": 1, "distance_m": 1}

    def run(r):
        return list(db.listings.aggregate([
            {"$geoNear": {"near": listing["loc"], "distanceField": "distance_m", "maxDistance": r,
                          "query": query, "spherical": True}},
            {"$limit": max_n}, {"$project": proj},
        ], maxTimeMS=300))

    used, docs = radius, run(radius)
    if len(docs) < 4:
        used, docs = radius * 2.5, run(radius * 2.5)
    items = [{"id": d["_id"], "url": d.get("url"), "address": d.get("address"), "m2": d.get("m2"),
              "rooms": d.get("rooms"), "year": d.get("year"), "price_m2": r2(price_m2(d)),
              "distance_m": round(d["distance_m"])} for d in docs if price_m2(d)]
    fair = float(np.median([i["price_m2"] for i in items])) if items else None
    return {"fair_m2": r2(fair), "n": len(items), "radius_m": used, "items": items}


def estimate_yield(listing):
    """Sale only: estimated monthly rent x 12 / debt-free price."""
    dfp = listing.get("debt_free_price") or listing.get("price")
    if not dfp or not listing.get("m2"):
        return None
    as_rental = {**listing, "kind": "rent", "fee_m2": None, "fee_month": None}
    rent_m2 = model_estimate(as_rental, "rent")
    if rent_m2 is None:
        rb = rent_baseline(listing.get("postcode"), listing.get("rooms"))
        rent_m2 = rb and rb["eur_m2"]
    return round(rent_m2 * float(listing["m2"]) * 12 / float(dfp), 4) if rent_m2 else None


# --- endpoint -------------------------------------------------------------------------------------------------
@app.post("/score")
def score(listing: dict = Body(...)):
    t0 = time.perf_counter()
    kind = listing.get("kind")
    if kind not in ("sale", "rent"):
        raise HTTPException(422, "listing.kind must be 'sale' or 'rent'")
    if not listing.get("m2"):
        raise HTTPException(422, "listing.m2 is required")
    m2 = float(listing["m2"])
    ask = price_m2(listing)
    art = MODELS.get(kind)

    baseline = (sale_baseline(listing.get("postcode"), listing.get("rooms"), listing.get("building_type"))
                if kind == "sale" else rent_baseline(listing.get("postcode"), listing.get("rooms")))
    model_m2 = model_estimate(listing, kind)
    try:
        comps = comparables(listing)
    except Exception as e:  # Mongo slow or down: score without comps rather than fail
        print("comps failed:", e)
        comps = None
    comps_m2 = comps["fair_m2"] if comps and comps["n"] >= 3 else None

    if model_m2 and comps_m2:
        w = art["w_model"]
        fair, method = w * model_m2 + (1 - w) * comps_m2, "blend"
    elif model_m2:
        fair, method = model_m2, "model"
    elif comps_m2:
        fair, method = comps_m2, "comps"
    elif baseline:
        calib = math.exp(art["calib_log"]) if art else 1.0
        fair, method = baseline["eur_m2"] * calib, "baseline"
    else:
        raise HTTPException(422, "not enough information to estimate a fair price")

    deal = (ask - fair) / fair if ask else None

    # Confidence: do the independent estimates agree, is there enough local evidence, is the gap plausible?
    spread = abs(math.log(model_m2 / comps_m2)) if model_m2 and comps_m2 else None
    n = comps["n"] if comps else 0
    big_gap = deal is not None and abs(deal) > 0.35
    if method == "blend" and n >= 5 and spread <= 0.10 and abs(deal or 0) <= 0.25:
        confidence = "high"
    elif method in ("blend", "model", "comps") and (spread is None or spread <= 0.20) and not big_gap \
            and (method != "comps" or n >= 6):
        confidence = "medium"
    else:
        confidence = "low"
    if listing.get("tenure") in ("hitas", "right_of_occupancy", "part_ownership"):
        confidence = "low"  # price-regulated: the market comparison doesn't really apply

    out = {
        "fair_m2": r2(fair),
        "fair_price": round(fair * m2),
        "deal_pct": round(deal, 3) if deal is not None else None,
        "confidence": confidence,
        "method": method,
        "model": {"fair_m2": r2(model_m2), "version": art["version"], "mae_pct": art["mae_pct"],
                  "w_model": art["w_model"]} if model_m2 else None,
        "comps": comps,
        "baseline": baseline,
        "yield_pct": estimate_yield(listing) if kind == "sale" else None,
        "scored_at": datetime.now(timezone.utc).isoformat(),
        "ms": round((time.perf_counter() - t0) * 1000, 1),
    }
    return out


@app.get("/health")
def health():
    return {"ok": True, "mongo": get_db() is not None,
            "models": {k: {"version": a["version"], "n_train": a["n_train"], "mae_pct": a["mae_pct"],
                           "blend_mae_pct": a["blend_mae_pct"], "w_model": a["w_model"],
                           "trained_at": a["trained_at"]} for k, a in MODELS.items()}}
