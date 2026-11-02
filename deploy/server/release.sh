#!/usr/bin/env bash
# Сборка и включение выпуска: bash release.sh /srv/lidomap/releases/<время>-<коммит> (код туда кладёт scripts/deploy-server.sh).
# Собирает от имени lidomap (dev-пакеты ставим явно: в /etc/lidomap/env NODE_ENV=production, без них npm пропустит tailwind), переключает current, перезапускает службу и ждёт ответа. Не поднялся — возвращает прошлый выпуск.
set -euo pipefail
REL=${1:?путь к выпуску}
[ -d "$REL" ] || { echo "нет каталога $REL" >&2; exit 1; }

runuser -u lidomap -- bash -c "cd '$REL' && set -a && . /etc/lidomap/env && set +a \
  && npm ci --include=dev --no-audit --no-fund --loglevel=error \
  && NODE_OPTIONS=--max-old-space-size=1536 npm run build"

PREV=$(readlink -f /srv/lidomap/current 2>/dev/null || true)
ln -sfn "$REL" /srv/lidomap/current
systemctl restart lidomap

ok=0
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null -H 'Host: lidomap.ru' http://127.0.0.1:3000/robots.txt; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "выпуск не ответил за минуту, возвращаю прошлый: ${PREV:-нет}" >&2
  journalctl -u lidomap -n 30 --no-pager >&2 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then ln -sfn "$PREV" /srv/lidomap/current; systemctl restart lidomap; fi
  exit 1
fi

# Прошлые выпуски удаляем: каждый весит ~700 МБ, а диск маленький. Для отката прошлый нужен только до проверки выше.
KEEP=$(readlink -f "$REL")
for d in /srv/lidomap/releases/*/; do [ "$(readlink -f "$d")" = "$KEEP" ] || rm -rf "$d"; done
echo "выпуск включён: $(basename "$REL")"
