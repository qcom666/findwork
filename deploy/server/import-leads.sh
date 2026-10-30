#!/usr/bin/env bash
# Приём свежего каталога заведений. Его присылает ежедневная сборка (.github/workflows/catalog.yml) ключом доставки,
# у которого в authorized_keys стоит command= этого скрипта: база приходит на stdin, сжатая zstd, больше этот ключ ничего не умеет.
# Подменяет базу только целой и не меньше 85% прежней, переносит в неё заведения, которые кто-то уже открыл (купленные
# контакты не должны пропасть, даже если заведение исчезло из открытых данных), перезапускает сайт и при сбое откатывает.
set -euo pipefail
DIR=/var/lib/lidomap
CUR=$DIR/leads.db
NEW=$DIR/leads.db.incoming
log() { echo "$*"; logger -t lidomap-import -- "$*"; }
fail() { log "отказ: $*"; rm -f "$NEW"; exit 1; }

exec 9>/run/lidomap-import.lock
flock -n 9 || fail "приём уже идёт"

zstd -dcq > "$NEW" || fail "не удалось распаковать"
[ "$(sqlite3 "$NEW" 'PRAGMA integrity_check' 2>/dev/null)" = ok ] || fail "база повреждена"
for t in places cities niches services meta city_niche places_fts; do
  [ "$(sqlite3 "$NEW" "SELECT count(*) FROM sqlite_master WHERE name = '$t'")" = 1 ] || fail "нет таблицы $t"
done
new_n=$(sqlite3 "$NEW" 'SELECT count(*) FROM places')
old_n=$(sqlite3 "$CUR" 'SELECT count(*) FROM places' 2>/dev/null || echo 0)
[ "$new_n" -ge $(( old_n * 85 / 100 )) ] || fail "в новой базе $new_n заведений против $old_n: подозрительно мало, оставляю прежнюю"

kept=$(sqlite3 "$NEW" <<SQL
ATTACH '$CUR' AS old;
ATTACH 'file:$DIR/app.db?mode=ro' AS app;
CREATE TEMP TABLE keep AS
  SELECT DISTINCT u.lead_id AS id FROM app.unlocks u WHERE u.lead_id NOT IN (SELECT id FROM main.places);
INSERT INTO main.places SELECT * FROM old.places WHERE id IN (SELECT id FROM keep);
INSERT INTO places_fts(rowid, name) SELECT rowid, name FROM main.places WHERE id IN (SELECT id FROM keep);
SELECT count(*) FROM keep;
SQL
) || fail "не удалось перенести открытые заведения"
sqlite3 "$NEW" 'ANALYZE;'

chown lidomap:lidomap "$NEW"
chmod 644 "$NEW"
[ -f "$CUR" ] && mv -f "$CUR" "$DIR/leads.db.prev"
mv -f "$NEW" "$CUR"
systemctl restart lidomap

for _ in $(seq 1 60); do
  if curl -fs -o /dev/null -H 'Host: lidomap.ru' http://127.0.0.1:3000/leads; then
    log "каталог обновлён: $(sqlite3 "$CUR" "SELECT group_concat(key || '=' || value, ', ') FROM meta WHERE key IN ('built_at','overture_release','total','osm_merged')"), сохранено открытых: $kept, было заведений: $old_n"
    exit 0
  fi
  sleep 1
done

log "сайт не поднялся на новой базе, возвращаю прежнюю"
mv -f "$CUR" "$DIR/leads.db.failed"
mv -f "$DIR/leads.db.prev" "$CUR"
systemctl restart lidomap
exit 1
