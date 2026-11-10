#!/usr/bin/env bash
# Забирает свежую зашифрованную транспортом SSH копию базы аккаунтов с VPS и хранит её на Mac 30 дней.
set -euo pipefail
umask 0077

HOST=${SERVER_HOST:-root@89.111.175.104}
KEY=${SERVER_KEY:-$HOME/.ssh/lidomap_proxy}
DEST=${LIDOMAP_BACKUP_DIR:-$HOME/Library/Application Support/Lidomap/backups}

install -d -m 700 "$DEST"
lock="$DEST/.pull.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "Копирование уже выполняется"
  exit 0
fi
trap 'rmdir "$lock" 2>/dev/null || true' EXIT

latest=$(ssh -i "$KEY" -o BatchMode=yes "$HOST" "find /var/backups/lidomap -maxdepth 1 -type f -name 'app-*.db.gz' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-")
[ -n "$latest" ] || { echo "На сервере нет копии базы" >&2; exit 1; }

target="$DEST/$(basename "$latest")"
tmp="$target.part"
scp -q -i "$KEY" -o BatchMode=yes "$HOST:$latest" "$tmp"
gzip -t "$tmp"
mv -f "$tmp" "$target"
chmod 600 "$target"
find "$DEST" -maxdepth 1 -type f -name 'app-*.db.gz' -mtime +30 -delete
echo "Скопировано: $target"
