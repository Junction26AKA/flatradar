"""Shared pieces for the FlatRadar fair-value model.

Everything that both train.py and serve.py need lives here, so the features a model is trained on
are exactly the features it is served with:
  - Mongo connection (reads MONGODB_URI / MONGODB_DB from the repo-root .env)
  - Statistics Finland baselines: load + lookup (sale: postcode x room type; rent: Helsinki zone x rooms)
  - the feature builder
"""
from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(__file__).resolve().parent
BASELINES_JSON = MODEL_DIR / "data" / "baselines.json"

try:  # .env is optional (Render sets real env vars)
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

SENATE_SQUARE = (60.1695, 24.9525)  # lat, lng: "the centre"

# ---------------------------------------------------------------------------------------------
# Mongo
# ---------------------------------------------------------------------------------------------
_client = None


def get_db():
    """Returns the flatradar database, or None when MONGODB_URI isn't set."""
    global _client
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        return None
    if _client is None:
        from pymongo import MongoClient

        _client = MongoClient(uri, serverSelectionTimeoutMS=5000, appname="flatradar-model")
    return _client[os.environ.get("MONGODB_DB", "flatradar")]


# ---------------------------------------------------------------------------------------------
# Rent zones. Statistics Finland splits Helsinki into 4 rent zones by postcode.
# Source: https://stat.fi/til/asvu/asvu_2014-06-17_luo_001.html (Vuositilaston aluejaot)
# ---------------------------------------------------------------------------------------------
_ZONES = {
    "091_1": "00100 00120 00130 00140 00150 00160 00170 00180 00220 00260",
    "091_2": "00200 00210 00250 00270 00280 00290 00300 00310 00320 00330 00340 00500 00510 00520 00530 "
    "00540 00550 00560 00570 00580 00590 00610 00810 00850 00990",
    "091_3": "00240 00350 00360 00370 00400 00430 00440 00620 00650 00660 00670 00680 00690 00730 00780 "
    "00790 00800 00830 00840 00950",
    "091_4": "00190 00230 00380 00390 00410 00420 00600 00630 00640 00700 00710 00720 00740 00750 00760 "
    "00770 00820 00860 00870 00880 00890 00900 00910 00920 00930 00940 00960 00970 00980",
}
POSTCODE_TO_ZONE = {pc: zone for zone, pcs in _ZONES.items() for pc in pcs.split()}
ZONE_NAMES = {"091": "Helsinki", "091_1": "Helsinki 1", "091_2": "Helsinki 2", "091_3": "Helsinki 3", "091_4": "Helsinki 4"}

SALE_ROOM_TYPES = {"1": "one-room", "2": "two-room", "3": "three-room+", "5": "terraced"}
RENT_ROOM_TYPES = {"1": "one-room", "2": "two-room", "3": "three-room+"}


def room_code(rooms) -> str | None:
    if rooms is None:
        return None
    try:
        r = int(rooms)
    except (TypeError, ValueError):
        return None
    return "1" if r <= 1 else "2" if r == 2 else "3"


def is_terraced(building_type) -> bool:
    bt = (building_type or "").lower()
    return any(k in bt for k in ("rivitalo", "paritalo", "erillistalo", "omakotitalo", "terraced"))


# ---------------------------------------------------------------------------------------------
# Baselines
# ---------------------------------------------------------------------------------------------
@lru_cache(maxsize=1)
def load_baselines() -> dict:
    """{"sale": {(postcode, room_code): [(year, eur_m2, n), ...]}, "rent": {(area, room_code): [(quarter, eur_m2, n)]}}.

    Reads model/data/baselines.json (written by baselines.py, committed to the repo) so serving never
    waits on Mongo or Statistics Finland."""
    raw = json.loads(BASELINES_JSON.read_text(encoding="utf-8"))
    out = {"sale": {}, "rent": {}}
    for d in raw:
        if d.get("eur_m2") is None:
            continue
        if d["kind"] == "sale":
            out["sale"].setdefault((d["postcode"], d["room"]), []).append((d["period"], d["eur_m2"], d.get("n")))
        else:
            out["rent"].setdefault((d["area"], d["room"]), []).append((d["period"], d["eur_m2"], d.get("n")))
    for table in out.values():
        for v in table.values():
            v.sort(reverse=True)  # newest period first
    return out


def _recent(series, min_n=8):
    """Latest period, or an n-weighted mean of up to the 3 latest periods when the latest one is thin."""
    if not series:
        return None
    period, eur, n = series[0]
    if n is None or n >= min_n:
        return period, eur
    top = series[:3]
    w = [max(x[2] or 1, 1) for x in top]
    return period, sum(x[1] * wi for x, wi in zip(top, w)) / sum(w)


@lru_cache(maxsize=1)
def _sale_room_ratios() -> dict:
    """Helsinki-wide price ratio of each room type vs the postcode mean, used to fill gaps."""
    b = load_baselines()["sale"]
    by_pc = {}
    for (pc, room), s in b.items():
        r = _recent(s)
        if r:
            by_pc.setdefault(pc, {})[room] = r[1]
    ratios = {}
    for room in SALE_ROOM_TYPES:
        xs = [d[room] / np.mean(list(d.values())) for d in by_pc.values() if room in d and len(d) >= 2]
        ratios[room] = float(np.median(xs)) if xs else 1.0
    return ratios


def sale_baseline(postcode, rooms, building_type=None) -> dict | None:
    """Realised €/m² for old dwellings (Statistics Finland 13mu) for this postcode and room type."""
    b = load_baselines()["sale"]
    room = "5" if is_terraced(building_type) else room_code(rooms) or "2"
    pc = (postcode or "").strip()
    hit = _recent(b.get((pc, room), []))
    note = None
    if not hit:  # same postcode, other room types, scaled by the city-wide room-type ratio
        ratios = _sale_room_ratios()
        others = [(_recent(s), r) for (p, r), s in b.items() if p == pc and _recent(s)]
        if others:
            mean = np.mean([rec[1] / ratios[r] for rec, r in others])
            hit = (max(rec[0] for rec, _ in others), float(mean * ratios[room]))
            note = "imputed from other room types in this postcode"
    if not hit:
        return None
    return {
        "source": "Statistics Finland 13mu",
        "postcode": pc,
        "room_type": SALE_ROOM_TYPES[room],
        "year": int(hit[0]),
        "eur_m2": round(float(hit[1])),
        **({"note": note} if note else {}),
    }


def rent_baseline(postcode, rooms) -> dict | None:
    """Average rent €/m²/month for new non-subsidised contracts (Statistics Finland 15fa), by Helsinki zone."""
    b = load_baselines()["rent"]
    room = room_code(rooms) or "2"
    area = POSTCODE_TO_ZONE.get((postcode or "").strip(), "091")
    hit = _recent(b.get((area, room), []), min_n=30) or _recent(b.get(("091", room), []), min_n=30)
    if not hit:
        return None
    if not b.get((area, room)):
        area = "091"
    return {
        "source": "Statistics Finland 15fa",
        "postcode": postcode,
        "area": ZONE_NAMES[area],
        "room_type": RENT_ROOM_TYPES[room],
        "year": hit[0],
        "eur_m2": round(float(hit[1]), 2),
    }


# ---------------------------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------------------------
def haversine_km(lat1, lng1, lat2, lng2):
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lng2 - lng1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


def latlng(listing):
    try:
        lng, lat = listing["loc"]["coordinates"]
        return float(lat), float(lng)
    except (KeyError, TypeError, ValueError):
        return None, None


def price_m2(listing) -> float | None:
    """The number everything compares on (contracts §1)."""
    m2 = listing.get("m2")
    if listing.get("kind") == "rent":
        p = listing.get("rent")
    else:
        p = listing.get("debt_free_price") or listing.get("price")
    try:
        return float(p) / float(m2) if p and m2 else None
    except (TypeError, ValueError):
        return None


def _num(x):
    try:
        return float(x) if x is not None and x != "" else np.nan
    except (TypeError, ValueError):
        return np.nan


def _bool(x):
    return np.nan if x is None else float(bool(x))


CONDITION = {"uudenveroinen": 4, "uusi": 4, "erinomainen": 4, "hyvä": 3, "tyydyttävä": 2, "välttävä": 1,
             "huono": 0, "heikko": 0}


def condition_score(text):
    """Free-text Finnish condition -> 0..4. 'Hyvä -/tyydyttävä +' -> 2.5; 'Hyvä, Uudenveroinen' -> 4; unknown -> NaN."""
    t = (text or "").lower()
    hits = [v for k, v in CONDITION.items() if k in t]
    if not hits:
        return np.nan
    if "uudenveroinen" in t:
        return 4.0
    return float(np.mean(sorted(set(hits))[-2:]))

FEATURES = [
    "log_sale_base",  # log Statistics Finland realised €/m², postcode x room type (also a location signal for rent)
    "log_rent_base",  # log Statistics Finland rent €/m², zone x rooms
    "m2",
    "rooms",
    "year",
    "floor",
    "floors_total",
    "top_floor",
    "elevator",
    "sauna",
    "balcony",
    "terraced",
    "plot_leased",
    "fee_m2",
    "condition",
    "dist_center_km",
    "lat",
    "lng",
]


def features(listing) -> dict:
    lat, lng = latlng(listing)
    sb = sale_baseline(listing.get("postcode"), listing.get("rooms"), listing.get("building_type"))
    rb = rent_baseline(listing.get("postcode"), listing.get("rooms"))
    floor, floors_total = _num(listing.get("floor")), _num(listing.get("floors_total"))
    cond = (listing.get("condition") or "").strip().lower()
    fee_m2 = _num(listing.get("fee_m2"))
    if np.isnan(fee_m2) and listing.get("fee_month") and listing.get("m2"):
        fee_m2 = _num(listing["fee_month"]) / _num(listing["m2"])
    return {
        "log_sale_base": math.log(sb["eur_m2"]) if sb else np.nan,
        "log_rent_base": math.log(rb["eur_m2"]) if rb else np.nan,
        "m2": _num(listing.get("m2")),
        "rooms": _num(listing.get("rooms")),
        "year": _num(listing.get("year")),
        "floor": floor,
        "floors_total": floors_total,
        "top_floor": float(floor == floors_total) if not (np.isnan(floor) or np.isnan(floors_total)) else np.nan,
        "elevator": _bool(listing.get("elevator")),
        "sauna": _bool(listing.get("sauna")),
        "balcony": _bool(listing.get("balcony")),
        "terraced": float(is_terraced(listing.get("building_type"))),
        "plot_leased": np.nan if listing.get("plot") is None else float(listing.get("plot") == "leased"),
        "fee_m2": fee_m2,
        "condition": condition_score(cond),
        "dist_center_km": haversine_km(lat, lng, *SENATE_SQUARE) if lat is not None else np.nan,
        "lat": lat if lat is not None else np.nan,
        "lng": lng if lng is not None else np.nan,
    }


def feature_matrix(listings) -> np.ndarray:
    return np.array([[features(l)[f] for f in FEATURES] for l in listings], dtype=float)


def trainable(listing) -> bool:
    """Same rule as the Node side: only comparable listings, and no price-regulated tenure."""
    if listing.get("comparable") is False or listing.get("portal") == "mock":
        return False
    if listing.get("tenure") in ("right_of_occupancy", "part_ownership", "hitas"):
        return False
    pm2 = price_m2(listing)
    if pm2 is None or not listing.get("m2") or listing["m2"] < 10:
        return False
    lo, hi = (8, 60) if listing.get("kind") == "rent" else (1500, 20000)
    return lo <= pm2 <= hi
