"""Train the fair-value models (one per kind) and print an honest accuracy report.

  python model/train.py                       # listings from Mongo (MONGODB_URI)
  python model/train.py --json dump.json      # or from a JSON array of listing documents

For each kind it compares, out-of-fold (5-fold CV, nothing is scored on data it was trained on):
  baseline  Statistics Finland postcode €/m² x a calibration ratio (asking vs realised)
  comps     median €/m² of nearby comparable listings (same rules as lib/score in Node)
  model     gradient boosting on log(€/m²)
  blend     w x model + (1 - w) x comps, with w fitted on the out-of-fold predictions
Saves model/<kind>.joblib (used by serve.py) and model/report.json (MAE + feature importance for the pitch).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import KFold

from common import FEATURES, MODEL_DIR, feature_fingerprint, feature_matrix, get_db, haversine_km, latlng, price_m2, trainable

VERSION = "gbr-v1"
SEED = 26


def load_listings(path=None):
    if path:
        return json.loads(open(path, encoding="utf-8").read())
    db = get_db()
    if db is None:
        raise SystemExit("Set MONGODB_URI in .env or pass --json <file>")
    return list(db.listings.find({}, {"score": 0, "flags": 0, "price_history": 0}))


def new_model():
    return HistGradientBoostingRegressor(
        learning_rate=0.05, max_iter=400, max_leaf_nodes=15, min_samples_leaf=12,
        l2_regularization=1.0, early_stopping=False, random_state=SEED,
    )


def base_col(kind):
    return FEATURES.index("log_sale_base" if kind == "sale" else "log_rent_base")


# --- comps, mirroring lib/score/index.mjs comparables() so offline numbers match the live service ----------
def comps_median(i, rows, pm2, radius_m=1000, max_n=12, min_n=3):
    """Leave-one-out comparables estimate for rows[i]; None if fewer than min_n comps."""
    l = rows[i]
    lat, lng = latlng(l)
    if lat is None:
        return None, 0
    cands = []
    for j, o in enumerate(rows):
        if j == i or not (0.75 * l["m2"] <= o["m2"] <= 1.25 * l["m2"]):
            continue
        if l.get("building_type") and o.get("building_type") != l.get("building_type"):
            continue
        if l.get("year") and (not o.get("year") or abs(o["year"] - l["year"]) > 15):
            continue
        olat, olng = latlng(o)
        if olat is None:
            continue
        cands.append((haversine_km(lat, lng, olat, olng) * 1000, pm2[j]))
    cands.sort()
    for r in (radius_m, radius_m * 2.5):
        near = [p for d, p in cands if d <= r][:max_n]
        if len(near) >= 4 or r != radius_m:
            break
    return (float(np.median(near)), len(near)) if len(near) >= min_n else (None, len(near))


def ape(pred, actual):
    return np.abs(pred - actual) / actual


def summarize(name, pred, actual):
    ok = ~np.isnan(pred)
    e = ape(pred[ok], actual[ok])
    return {"estimator": name, "coverage": round(float(ok.mean()), 3), "mae_pct": round(float(e.mean()), 4),
            "median_ape": round(float(np.median(e)), 4), "within_10pct": round(float((e <= 0.10).mean()), 3)}


def train_kind(kind, listings):
    rows = [l for l in listings if l.get("kind") == kind and trainable(l)]
    if len(rows) < 40:
        stale = MODEL_DIR / f"{kind}.joblib"
        if stale.exists():  # don't leave an old model behind for serve.py to load
            stale.unlink()
        print(f"[{kind}] only {len(rows)} usable listings, need >= 40; skipping (removed any old {kind}.joblib)")
        return None
    X_all = feature_matrix(rows)
    cols = [j for j in range(len(FEATURES)) if np.isfinite(X_all[:, j]).sum() >= 10]  # drop empty columns (e.g. fee_m2 for rent)
    X = X_all[:, cols]
    y_m2 = np.array([price_m2(l) for l in rows])
    y = np.log(y_m2)
    base = X_all[:, base_col(kind)]
    has_base = np.isfinite(base).any()
    # asking-price premium over realised prices, in log space (0 if no listing has a baseline, never NaN)
    calib = float(np.nanmedian(y - base)) if has_base else 0.0
    fallback_base = float(np.nanmedian(base)) if has_base else float(np.median(y))
    base_f = np.where(np.isnan(base), fallback_base, base)

    # Out-of-fold predictions for: absolute target vs residual-over-baseline target
    kf = KFold(n_splits=5, shuffle=True, random_state=SEED)
    oof = {"absolute": np.full(len(y), np.nan), "residual": np.full(len(y), np.nan)}
    importances = {"absolute": [], "residual": []}
    bj = cols.index(base_col(kind)) if base_col(kind) in cols else None
    rng = np.random.default_rng(SEED)
    for tr, te in kf.split(X):
        for mode in oof:
            target = y if mode == "absolute" else y - base_f
            m = new_model().fit(X[tr], target[tr])

            def predict_log(Xte, base_te):
                return m.predict(Xte) + (0 if mode == "absolute" else base_te)

            oof[mode][te] = predict_log(X[te], base_f[te])
            # Permutation importance measured on the final scale (MAE of log €/m²): in residual mode,
            # shuffling the baseline also shuffles the baseline we add back, so its importance isn't hidden.
            ref = np.mean(np.abs(oof[mode][te] - y[te]))
            imp = []
            for j in range(X.shape[1]):
                drops = []
                for _ in range(5):
                    perm = rng.permutation(len(te))
                    Xp = X[te].copy()
                    Xp[:, j] = Xp[perm, j]
                    bp = base_f[te][perm] if j == bj else base_f[te]
                    drops.append(np.mean(np.abs(predict_log(Xp, bp) - y[te])) - ref)
                imp.append(np.mean(drops))
            importances[mode].append(imp)
    mode = min(oof, key=lambda k: np.mean(ape(np.exp(oof[k]), y_m2)))
    importances = importances[mode]
    model_pred = np.exp(oof[mode])

    baseline_pred = np.where(np.isnan(base), np.nan, np.exp(base + calib))
    comps = [comps_median(i, rows, y_m2) for i in range(len(rows))]
    comps_pred = np.array([c[0] if c[0] is not None else np.nan for c in comps])

    both = ~np.isnan(comps_pred)
    weights = np.linspace(0, 1, 21)
    if both.sum() >= 20:
        errs = [np.mean(ape(w * model_pred[both] + (1 - w) * comps_pred[both], y_m2[both])) for w in weights]
        w_model = float(weights[int(np.argmin(errs))])
    else:
        w_model = 1.0
    blend_pred = np.where(both, w_model * model_pred + (1 - w_model) * np.nan_to_num(comps_pred), model_pred)

    report_rows = [
        summarize("baseline (Statistics Finland x calibration)", baseline_pred, y_m2),
        summarize("comps (median of nearby listings)", comps_pred, y_m2),
        summarize(f"model ({mode} target)", model_pred, y_m2),
        summarize(f"blend (w_model={w_model:.2f})", blend_pred, y_m2),
    ]
    log_err = np.abs(np.log(blend_pred) - y)

    # Fit the final model on everything
    final = new_model().fit(X, y if mode == "absolute" else y - base_f)
    imp = np.mean(importances, axis=0)
    importance = sorted(({"feature": FEATURES[j], "importance": round(float(v), 5)} for j, v in zip(cols, imp)),
                        key=lambda d: -d["importance"])
    mae = report_rows[3]["mae_pct"]
    artifact = {
        "model": final, "kind": kind, "version": VERSION, "features": FEATURES, "target": mode,
        "cols": cols, "base_col": base_col(kind), "fallback_log_base": fallback_base, "calib_log": calib,
        "w_model": w_model, "mae_pct": report_rows[2]["mae_pct"], "blend_mae_pct": mae,
        "log_err_p50": float(np.quantile(log_err, 0.5)), "log_err_p80": float(np.quantile(log_err, 0.8)),
        "n_train": len(rows), "trained_at": datetime.now(timezone.utc).isoformat(),
        # Out-of-fold model estimate per training listing. The final model has seen these listings' prices,
        # so serve.py uses these instead for them (otherwise every backfilled listing would look "fair").
        # Keyed by _id, with a fingerprint of the features so an edited listing is re-scored by the model.
        "oof_m2": {str(l["_id"]): [float(p), feature_fingerprint(x)]
                   for l, p, x in zip(rows, model_pred, X_all) if l.get("_id") is not None},
    }
    joblib.dump(artifact, MODEL_DIR / f"{kind}.joblib")

    # Hand-check sample: 10 listings with their OOF estimates, for the "checked by hand" slide
    rng = np.random.default_rng(SEED)
    sample = [{"id": rows[i].get("_id"), "url": rows[i].get("url"), "address": rows[i].get("address"),
               "m2": rows[i].get("m2"), "rooms": rows[i].get("rooms"), "year": rows[i].get("year"),
               "asking_m2": round(float(y_m2[i]), 2), "fair_m2": round(float(blend_pred[i]), 2),
               "deal_pct": round(float((y_m2[i] - blend_pred[i]) / blend_pred[i]), 3)}
              for i in rng.choice(len(rows), size=min(10, len(rows)), replace=False)]

    unit = "€/m²" if kind == "sale" else "€/m²/month"
    print(f"\n[{kind}] n={len(rows)}  median asking {np.median(y_m2):.2f} {unit}  "
          f"asking/realised calibration x{math.exp(calib):.3f}")
    print(f"  {'estimator':<46}{'coverage':>9}{'MAE %':>8}{'median':>8}{'<=10%':>8}")
    for r in report_rows:
        print(f"  {r['estimator']:<46}{r['coverage']:>9.0%}{r['mae_pct']:>8.1%}{r['median_ape']:>8.1%}{r['within_10pct']:>8.0%}")
    print("  top features:", ", ".join(f"{d['feature']} {d['importance']:.4f}" for d in importance[:6]))
    print(f"  saved model/{kind}.joblib")
    return {"kind": kind, "n": len(rows), "target": mode, "w_model": w_model, "calibration": math.exp(calib),
            "estimators": report_rows, "feature_importance": importance, "hand_check": sample}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="JSON array of listings instead of Mongo")
    args = ap.parse_args()
    listings = load_listings(args.json)
    print(f"loaded {len(listings)} listings")
    report = {"version": VERSION, "trained_at": datetime.now(timezone.utc).isoformat(),
              "method": "5-fold out-of-fold; error = |fair - asking| / asking on €/m²", "kinds": {}}
    for kind in ("sale", "rent"):
        r = train_kind(kind, listings)
        if r:
            report["kinds"][kind] = r
    (MODEL_DIR / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print("\nwrote model/report.json")


if __name__ == "__main__":
    main()
