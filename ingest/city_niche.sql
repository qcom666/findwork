-- Сводка «сколько заведений без своего сайта в каждой нише города». Страницы городов и ниш и sitemap читают её вместо
-- GROUP BY по 400 тысячам строк. Для уже собранной базы: sqlite3 data/leads.db < ingest/city_niche.sql
-- и то же для Turso: turso db shell <база каталога> < ingest/city_niche.sql. build_db.py создаёт её сам.
DROP TABLE IF EXISTS city_niche;
CREATE TABLE city_niche (city TEXT NOT NULL, niche TEXT NOT NULL, n_need INTEGER NOT NULL, PRIMARY KEY (city, niche)) WITHOUT ROWID;
INSERT INTO city_niche
  SELECT city, niche, count(*) FROM places
  WHERE city IS NOT NULL AND site_kind IN ('none', 'social', 'builder') AND is_chain = 0
  GROUP BY city, niche;
CREATE INDEX ix_city_niche_niche ON city_niche(niche, n_need DESC);
