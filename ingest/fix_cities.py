#!/usr/bin/env python3
"""Печатает SQL, который приводит названия городов в уже собранной базе к русским и пересчитывает таблицу cities.

Нужен, чтобы не пересобирать и не перезаливать весь каталог ради правки названий:
  ingest/.venv/bin/python ingest/fix_cities.py | sqlite3 data/leads.db
  ingest/.venv/bin/python ingest/fix_cities.py | turso db shell <имя базы>
Повторный запуск безопасен.
"""
from common import CITY_RU


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


whens = " ".join(f"WHEN {q(k)} THEN {q(v)}" for k, v in CITY_RU.items())
keys = ", ".join(q(k) for k in CITY_RU)
print(f"UPDATE places SET city = CASE city {whens} END WHERE city IN ({keys});")
print("DELETE FROM cities;")
print(
    "INSERT INTO cities SELECT city, count(*), count(*) FILTER (WHERE site_kind <> 'real' AND is_chain = 0) "
    "FROM places WHERE city IS NOT NULL GROUP BY city HAVING count(*) >= 30;"
)
