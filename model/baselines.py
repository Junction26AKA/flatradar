"""Pull Statistics Finland baselines for Helsinki into model/data/baselines.json and Mongo `baselines`.

  python model/baselines.py            # fetch, write JSON, upsert to Mongo if MONGODB_URI is set

Sale: StatFin/ashi/13mu  €/m² + number of sales, postcode x (1-room, 2-room, 3-room+, terraced), 2023-2025.
Rent: StatFin/asvu/15fa  average rent €/m² for new non-subsidised contracts, Helsinki + zones 1-4 x rooms, all quarters.
"""
from __future__ import annotations

import json
import sys

import requests

from common import BASELINES_JSON, get_db

API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin"
SALE_TABLE, RENT_TABLE = f"{API}/ashi/13mu.px", f"{API}/asvu/15fa.px"


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None  # ".." / "." = suppressed or missing


def _query(url, selection):
    body = {
        "query": [{"code": k, "selection": {"filter": "item", "values": v}} for k, v in selection.items()],
        "response": {"format": "json-stat2"},
    }
    r = requests.post(url, json=body, timeout=60)
    r.raise_for_status()
    return r.json()


def _cells(js):
    """Iterate json-stat2 as ({dim: code}, value) pairs."""
    dims = js["id"]
    cats = [sorted(js["dimension"][d]["category"]["index"].items(), key=lambda kv: kv[1]) for d in dims]
    sizes = js["size"]
    for flat, value in enumerate(js["value"]):
        idx, rem = [], flat
        for s in reversed(sizes):
            idx.append(rem % s)
            rem //= s
        idx.reverse()
        yield {d: cats[i][j][0] for i, (d, j) in enumerate(zip(dims, idx))}, value


def sale_rows():
    meta = requests.get(SALE_TABLE, timeout=30).json()
    var = {v["code"]: v for v in meta["variables"]}
    pc_var = next(c for c in var if c.startswith("postinumero"))
    room_var = next(c for c in var if c.startswith("talotyyppi"))
    year_var = next(c for c in var if c.startswith("timeperiod"))
    helsinki = [c for c, t in zip(var[pc_var]["values"], var[pc_var]["valueTexts"]) if t.endswith("(Helsinki)")]
    years = var[year_var]["values"][-3:]
    js = _query(SALE_TABLE, {pc_var: helsinki, room_var: ["1", "2", "3", "5"], year_var: years,
                             "contentscode": ["keskihinta_aritm_nw", "lkm_julk20"]})
    acc = {}
    for c, v in _cells(js):
        key = (c[pc_var], c[room_var], c[year_var])
        acc.setdefault(key, {})["eur_m2" if c["contentscode"] == "keskihinta_aritm_nw" else "n"] = _num(v)
    print(f"sale: {len(helsinki)} Helsinki postcodes x 4 room types x {years}")
    return [
        {"_id": f"sale:{pc}:{room}:{year}", "kind": "sale", "source": "Statistics Finland 13mu",
         "postcode": pc, "room": room, "period": year, "eur_m2": d.get("eur_m2"),
         "n": int(d["n"]) if d.get("n") is not None else None}
        for (pc, room, year), d in acc.items()
    ]


def rent_rows():
    meta = requests.get(RENT_TABLE, timeout=30).json()
    var = {v["code"]: v for v in meta["variables"]}
    area_var = next(c for c in var if c.startswith("alue"))
    fund_var = next(c for c in var if c.startswith("rahoitus"))
    room_var = next(c for c in var if c.startswith("huoneluku"))
    q_var = next(c for c in var if c.startswith("timeperiod"))
    js = _query(RENT_TABLE, {area_var: ["091", "091_1", "091_2", "091_3", "091_4"], fund_var: ["1"],
                             room_var: ["1", "2", "3"], q_var: var[q_var]["values"],
                             "contentscode": ["asvu_keskineliovuokra_u", "asvu_keskineliovuokra_u_lkm"]})
    acc = {}
    for c, v in _cells(js):
        key = (c[area_var], c[room_var], c[q_var])
        acc.setdefault(key, {})["n" if c["contentscode"].endswith("_lkm") else "eur_m2"] = _num(v)
    print(f"rent: Helsinki + zones 1-4 x 3 room types x {len(var[q_var]['values'])} quarters (new non-subsidised contracts)")
    return [
        {"_id": f"rent:{area}:{room}:{q}", "kind": "rent", "source": "Statistics Finland 15fa",
         "area": area, "room": room, "period": q, "eur_m2": d.get("eur_m2"),
         "n": int(d["n"]) if d.get("n") is not None else None}
        for (area, room, q), d in acc.items()
    ]


def main():
    rows = sale_rows() + rent_rows()
    BASELINES_JSON.parent.mkdir(parents=True, exist_ok=True)
    BASELINES_JSON.write_text(json.dumps(rows, indent=0, ensure_ascii=False), encoding="utf-8")
    have = sum(r["eur_m2"] is not None for r in rows)
    print(f"wrote {len(rows)} rows ({have} with a value) to {BASELINES_JSON}")

    db = get_db()
    if db is None:
        print("MONGODB_URI not set: skipped Mongo upsert")
        return
    from pymongo import ReplaceOne

    res = db.baselines.bulk_write([ReplaceOne({"_id": r["_id"]}, r, upsert=True) for r in rows])
    print(f"mongo baselines: {res.upserted_count} inserted, {res.modified_count} updated")


if __name__ == "__main__":
    sys.exit(main())
