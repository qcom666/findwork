#!/usr/bin/env python3
"""Шаг 2. Выгружает заведения из OpenStreetMap через Overpass API в data/osm_ru.parquet.

Данные OSM лежат под ODbL: нужно указывать «© участники OpenStreetMap», а производную базу,
которую вы публично распространяете, отдавать под той же лицензией. Поэтому в итоговой базе
каждая запись помнит, что часть данных пришла из OSM.

Публичный Overpass не рассчитан на выгрузку всей страны одним запросом, поэтому город режется
на небольшие плитки, ответы кэшируются на диске, между запросами есть пауза. Прерванный запуск
можно просто повторить: готовые плитки не качаются заново. Для всей России лучше взять выгрузку
Geofabrik (russia-latest.osm.pbf) и обработать её локально, см. README.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "osm_cache"
OUT = DATA / "osm_ru.parquet"

SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
UA = "FindWork-ingest/0.1 (lead generation for freelancers; contact: sgovno616@gmail.com)"

# имя: (юг, запад, север, восток, шаг по широте, шаг по долготе)
CITIES = {
    "Новосибирск": (54.90, 82.75, 55.15, 83.20, 0.10, 0.15),
    "Екатеринбург": (56.70, 60.40, 56.95, 60.85, 0.10, 0.15),
    "Казань": (55.65, 48.85, 55.95, 49.40, 0.10, 0.15),
    "Нижний Новгород": (56.20, 43.75, 56.40, 44.15, 0.10, 0.15),
    "Челябинск": (55.05, 61.25, 55.25, 61.55, 0.10, 0.15),
    "Краснодар": (44.95, 38.85, 45.15, 39.25, 0.10, 0.15),
    "Самара": (53.10, 49.95, 53.35, 50.45, 0.10, 0.15),
    "Ростов-на-Дону": (47.15, 39.50, 47.35, 39.90, 0.10, 0.15),
    "Уфа": (54.65, 55.85, 54.85, 56.20, 0.10, 0.15),
    "Красноярск": (55.95, 92.70, 56.10, 93.10, 0.10, 0.15),
    "Воронеж": (51.55, 39.05, 51.80, 39.40, 0.10, 0.15),
    "Пермь": (57.90, 56.05, 58.10, 56.40, 0.10, 0.15),
    "Волгоград": (48.55, 44.35, 48.85, 44.65, 0.10, 0.15),
    "Санкт-Петербург": (59.80, 30.05, 60.10, 30.55, 0.06, 0.10),
    "Москва": (55.49, 37.32, 56.01, 37.97, 0.05, 0.08),
}

AMENITY = (
    "restaurant|cafe|fast_food|bar|pub|biergarten|food_court|ice_cream|dentist|clinic|doctors|veterinary|"
    "pharmacy|car_wash|car_repair|driving_school|language_school|music_school|kindergarten|coworking_space|"
    "studio|nightclub|cinema|theatre|spa|childcare|fuel|bank"
)
TOURISM = "hotel|hostel|guest_house|apartment|motel|chalet|camp_site"
LEISURE = "fitness_centre|sports_centre|dance|swimming_pool|yoga|escape_game|bowling_alley|playground"

QUERY = """[out:json][timeout:90];
(
  nwr["name"]["shop"]({b});
  nwr["name"]["amenity"~"^({amenity})$"]({b});
  nwr["name"]["craft"]({b});
  nwr["name"]["office"]({b});
  nwr["name"]["tourism"~"^({tourism})$"]({b});
  nwr["name"]["leisure"~"^({leisure})$"]({b});
  nwr["name"]["healthcare"]({b});
);
out center tags;"""

KEYS = ["shop", "amenity", "craft", "office", "tourism", "leisure", "healthcare"]


def first(tags, *keys):
    for k in keys:
        v = tags.get(k)
        if v:
            return v.strip()
    return None


def compact(el):
    t = el.get("tags", {})
    lat = el.get("lat") or (el.get("center") or {}).get("lat")
    lon = el.get("lon") or (el.get("center") or {}).get("lon")
    if lat is None or lon is None or not t.get("name"):
        return None
    osm_key = next((f"{k}={t[k]}" for k in KEYS if k in t), None)
    street = t.get("addr:street")
    house = t.get("addr:housenumber")
    return {
        "osm_id": f"{el['type'][0]}{el['id']}",
        "name": t["name"].strip(),
        "lat": lat,
        "lon": lon,
        "osm_key": osm_key,
        "phone": first(t, "phone", "contact:phone", "mobile", "contact:mobile"),
        "website": first(t, "website", "contact:website", "url"),
        "email": first(t, "email", "contact:email"),
        "vk": first(t, "contact:vk", "vk"),
        "instagram": first(t, "contact:instagram", "instagram"),
        "telegram": first(t, "contact:telegram", "telegram"),
        "facebook": first(t, "contact:facebook", "facebook"),
        "city_tag": t.get("addr:city"),
        "address": ", ".join(x for x in [street, house] if x) or None,
        "brand": t.get("brand"),
        "brand_wikidata": t.get("brand:wikidata"),
    }


def fetch(query: str):
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(4):
        server = SERVERS[attempt % len(SERVERS)]
        req = urllib.request.Request(server, data=body, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code} {server}"
            time.sleep(40 if e.code in (429, 504) else 10)
        except Exception as e:  # сеть, таймаут, битый json
            last = f"{type(e).__name__}: {str(e)[:80]} {server}"
            time.sleep(10)
    raise RuntimeError(last)


def frange(a, b, step):
    x = a
    while x < b - 1e-9:
        yield x, min(x + step, b)
        x += step


def run_city(name, bbox, delay):
    s, w, n, e, dlat, dlon = bbox
    tiles = [(a, b, c, d) for a, b in frange(s, n, dlat) for c, d in frange(w, e, dlon)]
    rows, failed = 0, 0
    for i, (a, b, c, d) in enumerate(tiles, 1):
        f = CACHE / f"{name}_{a:.3f}_{c:.3f}.jsonl"
        if f.exists():
            rows += sum(1 for _ in f.open())
            continue
        q = QUERY.format(b=f"{a:.4f},{c:.4f},{b:.4f},{d:.4f}", amenity=AMENITY, tourism=TOURISM, leisure=LEISURE)
        try:
            data = fetch(q)
        except RuntimeError as err:
            failed += 1
            print(f"  {name} плитка {i}/{len(tiles)}: ошибка ({err}), пропускаю", flush=True)
            continue
        out = [r for r in (compact(x) for x in data.get("elements", [])) if r]
        for r in out:
            r["query_city"] = name
        with f.open("w") as fh:
            for r in out:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
        rows += len(out)
        print(f"  {name} плитка {i}/{len(tiles)}: {len(out)} объектов", flush=True)
        time.sleep(delay)
    return rows, failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", help="список через запятую; по умолчанию все из CITIES")
    ap.add_argument("--delay", type=float, default=2.0, help="пауза между запросами, с")
    args = ap.parse_args()

    names = [c.strip() for c in args.cities.split(",")] if args.cities else list(CITIES)
    unknown = [c for c in names if c not in CITIES]
    if unknown:
        sys.exit(f"Неизвестные города: {unknown}. Доступны: {list(CITIES)}")

    CACHE.mkdir(parents=True, exist_ok=True)
    total_failed = 0
    for name in names:
        t = time.time()
        print(f"{name}...", flush=True)
        rows, failed = run_city(name, CITIES[name], args.delay)
        total_failed += failed
        print(f"{name}: {rows} объектов, ошибок {failed}, {time.time() - t:.0f} с", flush=True)

    files = sorted(str(p) for p in CACHE.glob("*.jsonl"))
    if not files:
        sys.exit("Нет данных")
    con = duckdb.connect()
    con.execute(
        f"""COPY (SELECT DISTINCT ON (osm_id) * FROM read_json_auto({json.dumps(files)}, format='newline_delimited',
                  union_by_name=true, sample_size=-1)) TO '{OUT}' (FORMAT parquet, COMPRESSION zstd)"""
    )
    n = con.execute(f"SELECT count(*) FROM read_parquet('{OUT}')").fetchone()[0]
    print(f"Итого {n} объектов -> {OUT}" + (f" (плиток с ошибками: {total_failed}, повторите запуск)" if total_failed else ""))


if __name__ == "__main__":
    main()
