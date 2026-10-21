#!/usr/bin/env python3
"""Шаг 3. Склеивает Overture и OSM, убирает дубли, считает скоринг и пишет data/leads.db (SQLite).

Запуск: ingest/.venv/bin/python ingest/build_db.py
Если нет data/osm_ru.parquet, база собирается только из Overture.
"""
import json
import re
import sqlite3
import time
from collections import Counter, defaultdict
from math import cos, radians
from pathlib import Path

import duckdb
from rapidfuzz import fuzz

from common import (SERVICES, classify_url, clean_url, lead_score, lead_services, norm_name, norm_phone, ru_city)
from niches import NICHES, niche_for_osm, niche_for_overture

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OV = DATA / "overture_ru.parquet"
OSM = DATA / "osm_ru.parquet"
DB = DATA / "leads.db"

STREET = re.compile(
    r"\d|улиц|\bул\b|проспект|\bпр-?т\b|переул|шоссе|бульвар|набережн|площад|микрорайон|\bмкр\b|район|проезд|тупик|"
    r"аллея|линия|street|avenue|road",
    re.I,
)


def clean_city(city, address):
    c = (city or "").strip()
    c = re.sub(r"^(г\.?|город)\s+", "", c, flags=re.I).strip()
    if c:
        return ru_city(c)
    parts = [p.strip() for p in (address or "").split(",")]
    if len(parts) >= 2:
        first = re.sub(r"^(г\.?|город)\s+", "", parts[0], flags=re.I).strip()
        if first and not STREET.search(first) and len(first) <= 30:
            return first
    return None


def uniq(seq):
    seen, out = set(), []
    for x in seq:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def load_overture():
    con = duckdb.connect()
    cats = con.execute(f"SELECT DISTINCT category FROM read_parquet('{OV}') WHERE category IS NOT NULL").fetchall()
    mapping = {c[0]: niche_for_overture(c[0]) for c in cats}
    con.execute("CREATE TABLE cat_niche(category VARCHAR, niche VARCHAR)")
    con.executemany("INSERT INTO cat_niche VALUES (?, ?)", [(k, v) for k, v in mapping.items() if v])
    cur = con.execute(
        f"""SELECT o.*, m.niche FROM read_parquet('{OV}') o JOIN cat_niche m USING (category)
            WHERE coalesce(o.operating_status, 'open') <> 'permanently_closed'"""
    )
    cols = [d[0] for d in cur.description]
    recs = []
    while True:
        chunk = cur.fetchmany(50000)
        if not chunk:
            break
        for row in chunk:
            r = dict(zip(cols, row))
            recs.append(
                dict(
                    id=r["id"], name=r["name"].strip(), niche=r["niche"], category=r["category"],
                    city=clean_city(r["city"], r["address"]), address=r["address"], lat=r["lat"], lon=r["lon"],
                    phones=list(r["phones"] or []), emails=list(r["emails"] or []), websites=list(r["websites"] or []),
                    socials=list(r["socials"] or []), brand_wikidata=r["brand_wikidata"], confidence=r["confidence"],
                    sources={f"overture:{(r['source'] or 'unknown').lower()}"},
                )
            )
    return recs


def load_osm():
    if not OSM.exists():
        return []
    con = duckdb.connect()
    cur = con.execute(f"SELECT * FROM read_parquet('{OSM}')")
    cols = [d[0] for d in cur.description]
    recs = []
    for row in cur.fetchall():
        r = dict(zip(cols, row))
        niche = niche_for_osm(r["osm_key"])
        if not niche:
            continue
        socials = [r.get(k) for k in ("vk", "instagram", "telegram", "facebook")]
        recs.append(
            dict(
                id="osm:" + r["osm_id"], name=r["name"], niche=niche, category=r["osm_key"],
                city=r["query_city"],  # addr:city в OSM часто содержит посёлок или район, а не город
                address=r["address"], lat=r["lat"], lon=r["lon"],
                phones=[r["phone"]] if r["phone"] else [], emails=[r["email"]] if r["email"] else [],
                websites=[r["website"]] if r["website"] else [],
                socials=[s for s in socials if s and "." in s], brand_wikidata=r["brand_wikidata"],
                confidence=None, sources={"osm"},
            )
        )
    return recs


def fill_missing_cities(recs):
    """У ~16% записей Overture нет города. Берём ближайший известный город в радиусе ~25 км."""
    cnt = Counter(r["city"] for r in recs if r["city"])
    sums = defaultdict(lambda: [0.0, 0.0, 0])
    for r in recs:
        if r["city"] and cnt[r["city"]] >= 150:
            s = sums[r["city"]]
            s[0] += r["lat"]; s[1] += r["lon"]; s[2] += 1
    centers = [(c, s[0] / s[2], s[1] / s[2]) for c, s in sums.items()]
    fixed = 0
    for r in recs:
        if r["city"]:
            continue
        k = cos(radians(r["lat"]))
        best, bd = None, 0.25 ** 2
        for c, la, lo in centers:
            d = (r["lat"] - la) ** 2 + ((r["lon"] - lo) * k) ** 2
            if d < bd:
                best, bd = c, d
        if best:
            r["city"] = best
            fixed += 1
    return fixed


def merge_osm(ov, osm):
    """Приклеиваем OSM к Overture: то же место (≤ ~120 м) и похожее название либо общий телефон."""
    grid = defaultdict(list)
    for i, r in enumerate(ov):
        grid[(int(r["lat"] / 0.001), int(r["lon"] / 0.0015))].append(i)
    merged, added = 0, []
    for o in osm:
        gy, gx = int(o["lat"] / 0.001), int(o["lon"] / 0.0015)
        on = norm_name(o["name"])
        ophones = {norm_phone(p) for p in o["phones"]} - {None}
        hit = None
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for i in grid.get((gy + dy, gx + dx), ()):
                    r = ov[i]
                    k = cos(radians(o["lat"])) * 111_000
                    dist = (((r["lat"] - o["lat"]) * 111_000) ** 2 + ((r["lon"] - o["lon"]) * k) ** 2) ** 0.5
                    if dist > 120:
                        continue
                    rn = r.setdefault("_n", norm_name(r["name"]))
                    same_name = bool(on and rn) and fuzz.token_set_ratio(on, rn) >= 86
                    same_phone = bool(ophones) and bool(ophones & {norm_phone(p) for p in r["phones"]})
                    if same_name or same_phone:
                        hit = r
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            hit["phones"] += o["phones"]; hit["emails"] += o["emails"]
            hit["websites"] += o["websites"]; hit["socials"] += o["socials"]
            hit["sources"].add("osm")
            hit["address"] = hit["address"] or o["address"]
            merged += 1
        else:
            added.append(o)
    return merged, added


def finalize(recs):
    freq = Counter()
    for r in recs:
        r["_n"] = r.get("_n") or norm_name(r["name"])
        freq[r["_n"]] += 1

    out = []
    for r in recs:
        phones = uniq(norm_phone(p) for p in r["phones"])
        emails = uniq(e.strip().lower() for e in r["emails"] if e and "@" in e)
        reals, builders, socials = [], [], []
        for w in r["websites"]:
            kind, _host = classify_url(w)
            u = clean_url(w)
            if kind == "real":
                reals.append(u)
            elif kind == "builder":
                builders.append(u)
            elif kind == "social":
                socials.append(u)
        for s in r["socials"]:
            kind, _h = classify_url(s)
            if kind == "social":
                socials.append(clean_url(s))
        reals = sorted(uniq(reals), key=lambda u: not u.startswith("https"))
        builders, socials = uniq(builders), uniq(socials)
        if reals:
            site_kind, website = "real", reals[0]
        elif builders:
            site_kind, website = "builder", builders[0]
        elif socials:
            site_kind, website = "social", None
        else:
            site_kind, website = "none", None

        niche = NICHES[r["niche"]]
        is_chain = bool(r["brand_wikidata"]) or (len(r["_n"]) >= 3 and freq[r["_n"]] >= 8)
        sc = lead_score(site_kind, bool(phones), bool(emails), bool(socials), is_chain, r["confidence"], niche["ticket"])
        svc = lead_services(site_kind, bool(socials), niche["flags"])
        out.append(
            (
                r["id"], r["name"], r["niche"], r["category"], r["city"], r["address"], r["lat"], r["lon"],
                phones[0] if phones else None, json.dumps(phones[:4]), emails[0] if emails else None, website,
                site_kind, json.dumps(socials[:5]), int(bool(phones)), int(bool(emails)), int(bool(socials)),
                int(is_chain), r["confidence"], ",".join(sorted(r["sources"])), sc, ",".join(svc), r["_n"],
            )
        )
    return out


SCHEMA = """
CREATE TABLE places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, niche TEXT NOT NULL, category TEXT, city TEXT, address TEXT,
  lat REAL, lon REAL, phone TEXT, phones TEXT, email TEXT, website TEXT, site_kind TEXT NOT NULL, socials TEXT,
  has_phone INTEGER, has_email INTEGER, has_social INTEGER, is_chain INTEGER, confidence REAL, sources TEXT,
  score INTEGER, services TEXT, name_norm TEXT
);
CREATE TABLE niches (id TEXT PRIMARY KEY, label TEXT, n INTEGER, n_need INTEGER);
CREATE TABLE cities (name TEXT PRIMARY KEY, n INTEGER, n_need INTEGER);
CREATE TABLE services (id TEXT PRIMARY KEY, label TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""


def write_db(rows, meta):
    if DB.exists():
        DB.unlink()
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    con.executemany("INSERT INTO places VALUES (" + ",".join("?" * 23) + ")", rows)
    con.executemany("INSERT INTO services VALUES (?,?)", list(SERVICES.items()))
    con.executemany(
        "INSERT INTO niches SELECT ?, ?, count(*), count(*) FILTER (WHERE site_kind <> 'real' AND is_chain = 0) "
        "FROM places WHERE niche = ?",
        [(k, v["label"], k) for k, v in NICHES.items()],
    )
    con.execute(
        "INSERT INTO cities SELECT city, count(*), count(*) FILTER (WHERE site_kind <> 'real' AND is_chain = 0) "
        "FROM places WHERE city IS NOT NULL GROUP BY city HAVING count(*) >= 30"
    )
    con.executemany("INSERT INTO meta VALUES (?,?)", list(meta.items()))
    con.executescript((Path(__file__).parent / "city_niche.sql").read_text(encoding="utf-8"))
    con.executescript(
        """
        CREATE INDEX ix_city_niche_score ON places(city, niche, score DESC);
        CREATE INDEX ix_niche_score ON places(niche, score DESC);
        CREATE INDEX ix_score ON places(score DESC);
        CREATE INDEX ix_site ON places(site_kind);
        -- под запросы каталога: порядок по оценке или названию без сортировки в памяти
        CREATE INDEX ix_chain_score ON places(is_chain, score DESC);
        CREATE INDEX ix_chain_name ON places(is_chain, name);
        CREATE INDEX ix_city_chain_score ON places(city, is_chain, score DESC);
        CREATE VIRTUAL TABLE places_fts USING fts5(name, content='places', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
        INSERT INTO places_fts(rowid, name) SELECT rowid, name FROM places;
        INSERT INTO places_fts(places_fts) VALUES('optimize');
        ANALYZE;
        """
    )
    con.commit()
    con.close()


def main():
    t0 = time.time()
    ov = load_overture()
    print(f"Overture: {len(ov)} заведений в целевых нишах", flush=True)
    fixed = fill_missing_cities(ov)
    print(f"  город определён по координатам у {fixed}", flush=True)
    osm = load_osm()
    merged = 0
    if osm:
        print(f"OSM: {len(osm)} заведений в целевых нишах", flush=True)
        merged, added = merge_osm(ov, osm)
        print(f"  склеено с Overture: {merged}, новых: {len(added)}", flush=True)
        ov += added
    rows = finalize(ov)
    rel = (DATA / "overture_release.txt").read_text().strip() if (DATA / "overture_release.txt").exists() else "?"
    meta = {
        "built_at": time.strftime("%Y-%m-%d"),
        "overture_release": rel,
        "total": str(len(rows)),
        "osm_merged": str(merged),
        "has_osm": "1" if osm else "0",
    }
    write_db(rows, meta)
    print(f"Готово: {len(rows)} записей -> {DB} ({DB.stat().st_size / 1e6:.0f} МБ), {time.time() - t0:.0f} с")


if __name__ == "__main__":
    main()
