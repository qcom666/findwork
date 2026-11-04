#!/usr/bin/env bash
# Ключи сайта на сервере в Москве: спрашивает их по одному и записывает в /etc/lidomap/env, ничего не показывая на экране.
# Пустой ответ оставляет прежнее значение. После записи перезапускает сайт.
#   bash scripts/server-secrets.sh
set -euo pipefail
HOST=${SERVER_HOST:-root@89.111.175.104}
KEY=${SERVER_KEY:-$HOME/.ssh/lidomap_proxy}

ask() {
  local name=$1 hint=$2 value
  read -r -s -p "$name ($hint): " value; echo
  [ -z "$value" ] && return 0
  case "$value" in *[\"\$\`\\\ ]*) echo "  в значении есть пробел или спецсимвол, пропускаю $name" >&2; return 0;; esac
  # Значение уходит на сервер через stdin, а не в командной строке.
  printf '%s=%s\n' "$name" "$value" | ssh -i "$KEY" -o BatchMode=yes "$HOST" 'set -e; read -r line; name=${line%%=*}; value=${line#*=};
    f=/etc/lidomap/env; tmp=$(mktemp); grep -v "^$name=" "$f" > "$tmp" || true; printf "%s=\"%s\"\n" "$name" "$value" >> "$tmp";
    install -m 640 -g lidomap "$tmp" "$f"; rm -f "$tmp"'
  echo "  $name записан"
}

ask TELEGRAM_BOT_TOKEN "токен бота из @BotFather → /mybots → API Token"
ask YOOKASSA_SECRET_KEY "секретный ключ из кабинета ЮKassa → Интеграция → Ключи API"
ask TRIAL_ENABLED "1 — показать неделю за 1 ₽, когда ЮKassa включит автоплатежи; 0 — скрыть"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'systemctl restart lidomap 2>/dev/null || true'
echo "Готово."
