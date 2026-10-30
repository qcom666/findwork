#!/usr/bin/env python3
"""Шаг 2 для всей России. Заведения из ежедневной выгрузки OpenStreetMap (Geofabrik, russia-latest.osm.pbf) в data/osm_ru.parquet.

Overpass (osm.py) не тянет всю страну, а Geofabrik пересобирает выгрузку каждые сутки: так каталог получает свежие правки OSM
день в день. Нужен osmium-tool (apt install osmium-tool / brew install osmium-tool). Формат записей тот же, что у osm.py.
Лицензия ODbL: каждая запись помнит, что часть данных пришла из OSM (см. build_db.py).

  python ingest/osm_pbf.py                 скачать свежую выгрузку и разобрать
  python ingest/osm_pbf.py --pbf file.pbf  разобрать уже скачанный файл (например, выгрузку одного региона для проверки)
"""
import argparse
import json
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import duckdb

from common import ru_city
from osm import AMENITY, KEYS, LEISURE, TOURISM, UA, first

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORK = DATA / "osm"
OUT = DATA / "osm_ru.parquet"
URL = "https://download.geofabrik.de/russia-latest.osm.pbf"


def download(dst: Path) -> None:
    t = time.time()
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r, dst.open("wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    print(f"  скачано {dst.stat().st_size / 1e9:.1f} ГБ за {time.time() - t:.0f} с", flush=True)


def osmium(*args: str) -> None:
    subprocess.run(["osmium", *args, "--overwrite", "--no-progress"], check=True)


def centroid(geom: dict):
    t, c = geom.get("type"), geom.get("coordinates")
    if t == "Point":
        return c[1], c[0]
    ring = c[0] if t == "Polygon" else c[0][0] if t == "MultiPolygon" else None
    if not ring:
        return None
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)


def record(feature: dict):
    t = feature.get("properties") or {}
    name = (t.get("name") or "").strip()
    pos = centroid(feature.get("geometry") or {})
    if not name or not pos:
        return None
    osm_key = next((f"{k}={t[k]}" for k in KEYS if k in t), None)
    street, house = t.get("addr:street"), t.get("addr:housenumber")
    return {
        "osm_id": f"{str(t.get('@type', 'n'))[0]}{t.get('@id')}",
        "name": name,
        "lat": pos[0],
        "lon": pos[1],
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
        # Для всей страны города по плиткам нет: берём addr:city, а пустой build_db.py заполнит ближайшим городом.
        "query_city": ru_city(t.get("addr:city").strip()) if t.get("addr:city") else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf", help="готовый .osm.pbf вместо скачивания с Geofabrik")
    args = ap.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    pbf = Path(args.pbf) if args.pbf else WORK / "russia-latest.osm.pbf"
    if not args.pbf:
        print(f"Скачиваю {URL}...", flush=True)
        download(pbf)

    pois = WORK / "pois.osm.pbf"
    seq = WORK / "pois.geojsonseq"
    print("Отбираю заведения (osmium tags-filter)...", flush=True)
    osmium(
        "tags-filter", str(pbf),
        "nwr/shop", "nwr/craft", "nwr/office", "nwr/healthcare",
        "nwr/amenity=" + AMENITY.replace("|", ","),
        "nwr/tourism=" + TOURISM.replace("|", ","),
        "nwr/leisure=" + LEISURE.replace("|", ","),
        "-o", str(pois),
    )
    print("Считаю координаты (osmium export)...", flush=True)
    osmium("export", str(pois), "-f", "geojsonseq", "--format-option", "print_record_separator=false",
           "--geometry-types=point,polygon", "-a", "type,id", "-o", str(seq))

    n = 0
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, dir=WORK) as tmp, seq.open() as src:
        for line in src:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            r = record(json.loads(line))
            if r:
                tmp.write(json.dumps(r, ensure_ascii=False) + "\n")
                n += 1
    con = duckdb.connect()
    con.execute(
        f"""COPY (SELECT DISTINCT ON (osm_id) * FROM read_json_auto('{tmp.name}', format='newline_delimited', sample_size=-1))
            TO '{OUT}' (FORMAT parquet, COMPRESSION zstd)"""
    )
    total = con.execute(f"SELECT count(*) FROM read_parquet('{OUT}')").fetchone()[0]
    Path(tmp.name).unlink()
    print(f"Итого {total} заведений с названием из {n} объектов за {time.time() - t0:.0f} с -> {OUT}", flush=True)


if __name__ == "__main__":
    main()
