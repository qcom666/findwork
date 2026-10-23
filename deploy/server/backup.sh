#!/usr/bin/env bash
# Ежедневная копия базы аккаунтов (пользователи, кредиты, платежи): .backup безопасен на работающей базе. Храним 14 дней.
# Каталог заведений не копируем: он пересобирается из открытых данных и лежит в репозитории сборщика.
set -euo pipefail
DEST=/var/backups/lidomap
F="$DEST/app-$(date +%Y%m%d-%H%M).db"
sqlite3 /var/lib/lidomap/app.db ".backup '$F'"
sqlite3 "$F" "PRAGMA integrity_check" | grep -qx ok
gzip -f "$F"
find "$DEST" -name 'app-*.db.gz' -mtime +14 -delete
