#!/usr/bin/env python3
"""Печатает SQL, который переводит уже собранный каталог на новые правила, не пересобирая и не перезаливая его целиком:

  * новая услуга «Вывеска и наружная реклама» (services) и она же в подсказках для заведений с витриной;
  * новая ниша «Реклама, полиграфия, вывески» (ads): переезд подходящих записей из business и добавление изготовителей
    вывесок (sign_making), которых раньше в каталоге не было;
  * пересчёт справочников niches и cities и полнотекстового индекса для новых строк.

Запуск:
  ingest/.venv/bin/python ingest/migrate_signage.py > /tmp/migrate.sql
  sqlite3 data/leads.db < /tmp/migrate.sql
  turso db shell <имя базы> < /tmp/migrate.sql
Повторный запуск безопасен.
"""
import sqlite3
import sys
from pathlib import Path

import build_db
from niches import NICHES

DB = Path(__file__).resolve().parent.parent / "data" / "leads.db"

ADS_CATEGORIES = sorted(NICHES["ads"]["slugs"]) + ["office=advertising_agency", "shop=copyshop", "craft=printer", "craft=sign_maker"]
STOREFRONT = [k for k, v in NICHES.items() if "storefront" in v["flags"]]


def q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def lst(items) -> str:
    return ", ".join(q(i) for i in items)


def main():
    existing = {r[0] for r in sqlite3.connect(DB).execute("SELECT id FROM places")}

    # Свежая сборка из Overture (без OSM), чтобы взять строки, которых в каталоге ещё нет.
    ov = build_db.load_overture()
    build_db.fill_missing_cities(ov)
    rows = [r for r in build_db.finalize(ov) if r[2] == "ads" and r[0] not in existing]
    print(f"-- новых заведений: {len(rows)}", file=sys.stderr)

    out = []
    out.append(f"INSERT OR IGNORE INTO services(id, label) VALUES ('signage', {q('Вывеска и наружная реклама')});")
    out.append(f"UPDATE places SET niche = 'ads' WHERE niche = 'business' AND category IN ({lst(ADS_CATEGORIES)});")

    cols = ("id,name,niche,category,city,address,lat,lon,phone,phones,email,website,site_kind,socials,has_phone,has_email,"
            "has_social,is_chain,confidence,sources,score,services,name_norm")
    for r in rows:
        out.append(f"INSERT OR IGNORE INTO places ({cols}) VALUES ({', '.join(q(v) for v in r)});")
    if rows:
        out.append(f"INSERT INTO places_fts(rowid, name) SELECT rowid, name FROM places WHERE id IN ({lst([r[0] for r in rows])});")

    out.append(
        "UPDATE places SET services = CASE WHEN services = '' THEN 'signage' ELSE services || ',signage' END "
        f"WHERE niche IN ({lst(STOREFRONT)}) AND site_kind <> 'real' AND (',' || services || ',') NOT LIKE '%,signage,%';"
    )
    labels = " ".join(f"WHEN {q(k)} THEN {q(NICHES[k]['label'])}" for k in ("ads", "business"))
    out.append("DELETE FROM niches WHERE id IN ('ads', 'business');")
    out.append(
        f"INSERT INTO niches(id, label, n, n_need) SELECT niche, CASE niche {labels} END, count(*), "
        "count(*) FILTER (WHERE site_kind <> 'real' AND is_chain = 0) FROM places WHERE niche IN ('ads', 'business') GROUP BY niche;"
    )
    out.append("DELETE FROM cities;")
    out.append(
        "INSERT INTO cities SELECT city, count(*), count(*) FILTER (WHERE site_kind <> 'real' AND is_chain = 0) "
        "FROM places WHERE city IS NOT NULL GROUP BY city HAVING count(*) >= 30;"
    )
    out.append("UPDATE meta SET value = CAST((SELECT count(*) FROM places) AS TEXT) WHERE key = 'total';")
    out.append("ANALYZE;")
    print("\n".join(out))


if __name__ == "__main__":
    main()
