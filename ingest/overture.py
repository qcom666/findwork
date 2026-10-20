#!/usr/bin/env python3
"""Шаг 1. Выгружает заведения России из Overture Maps (theme=places) в data/overture_ru.parquet.

Источник открытый: записи Places идут под CDLA-Permissive-2.0, CC0 и Apache-2.0,
коммерческое использование и хранение разрешены. Читаем публичный S3 напрямую, ключи не нужны.
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "overture_ru.parquet"
STAC = "https://stac.overturemaps.org/catalog.json"


def releases():
    with urllib.request.urlopen(STAC, timeout=30) as r:
        cat = json.load(r)
    return sorted((l["href"].split("/")[3] for l in cat["links"] if l["rel"] == "child"), reverse=True)


def extract(release: str):
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=8;")
    path = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    con.execute(
        f"""
        COPY (
          SELECT
            id,
            names.primary                AS name,
            confidence,
            websites, emails, socials, phones,
            brand.names.primary          AS brand,
            brand.wikidata               AS brand_wikidata,
            addresses[1].freeform        AS address,
            addresses[1].locality        AS city,
            addresses[1].region          AS region,
            addresses[1].postcode        AS postcode,
            taxonomy.primary             AS category,
            taxonomy.hierarchy           AS hierarchy,
            operating_status,
            sources[1].dataset           AS source,
            sources[1].license           AS license,
            bbox.xmin                    AS lon,
            bbox.ymin                    AS lat
          FROM read_parquet('{path}', hive_partitioning=1)
          WHERE bbox.xmin BETWEEN 19 AND 180 AND bbox.ymin BETWEEN 41 AND 82
            AND addresses[1].country = 'RU'
            AND names.primary IS NOT NULL
        ) TO '{OUT}' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    return con.execute(f"SELECT count(*) FROM read_parquet('{OUT}')").fetchone()[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", help="версия релиза Overture, по умолчанию самая свежая")
    args = ap.parse_args()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    candidates = [args.release] if args.release else releases()
    for rel in candidates:
        t = time.time()
        print(f"Overture release {rel}: читаю Places по России...", flush=True)
        try:
            n = extract(rel)
        except Exception as e:  # у свежего релиза бывает неполная выгрузка, пробуем предыдущий
            print(f"  не получилось ({type(e).__name__}: {str(e)[:120]}), пробую предыдущий", flush=True)
            continue
        (OUT.parent / "overture_release.txt").write_text(rel)
        print(f"  готово: {n} заведений за {time.time() - t:.0f} с -> {OUT}", flush=True)
        return
    raise SystemExit("Не удалось прочитать ни один релиз Overture")


if __name__ == "__main__":
    main()
