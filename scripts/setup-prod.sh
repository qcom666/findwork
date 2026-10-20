#!/usr/bin/env bash
# Одноразовая настройка продакшена: базы Turso, переменные Vercel и выкатка.
# Запускайте сами из папки проекта: скрипт использует ваши входы в turso и vercel,
# токены доходят из Turso прямо в Vercel и нигде не печатаются.
#
#   turso auth login          (один раз, откроет браузер)
#   scripts/setup-prod.sh [https://ваш-домен]
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.turso:$HOME/.local/node/bin:$PATH"  # сюда ставятся Turso CLI и Node

for c in turso vercel node; do command -v "$c" >/dev/null || { echo "Не найден $c"; exit 1; }; done
turso auth whoami >/dev/null 2>&1 || { echo "Сначала выполните: turso auth login"; exit 1; }
[ -f data/leads.db ] || { echo "Нет data/leads.db: соберите каталог (ingest/build_db.py)"; exit 1; }
[ -f .vercel/project.json ] || { echo "Проект не привязан: выполните vercel link"; exit 1; }

APP_URL="${1:-https://findwork-rouge.vercel.app}"
LEADS_DB="findwork-leads-$(date +%Y%m%d%H%M)"
APP_DB="findwork-app"

echo "1/4 Базы Turso"
# turso db create --from-file не принимает наш файл, поэтому создаём пустую базу и заливаем каталог сами.
turso db create "$LEADS_DB" --wait
LEADS_URL="$(turso db show "$LEADS_DB" --url)"
LEADS_TOKEN="$(turso db tokens create "$LEADS_DB")"
echo "  Заливаю каталог (несколько минут)..."
SRC=data/leads.db DEST_URL="$LEADS_URL" DEST_TOKEN="$LEADS_TOKEN" node scripts/push-leads.mjs
# База аккаунтов одна на всё время: в ней пользователи и платежи, пересоздавать её нельзя.
if turso db show "$APP_DB" >/dev/null 2>&1; then
  echo "  $APP_DB уже есть, использую её"
else
  turso db create "$APP_DB"
fi

set_env() { # имя значение [--sensitive]
  vercel env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | vercel env add "$1" production ${3:-} >/dev/null
  echo "  $1"
}

echo "2/4 Переменные Vercel"
set_env LEADS_DB_URL "$LEADS_URL"
set_env LEADS_DB_AUTH_TOKEN "$LEADS_TOKEN" --sensitive
set_env APP_DB_URL "$(turso db show "$APP_DB" --url)"
set_env APP_DB_AUTH_TOKEN "$(turso db tokens create "$APP_DB")" --sensitive
set_env APP_URL "$APP_URL"

echo "3/4 Остальное (Enter пропускает)"
ask() { # имя подсказка [секрет]
  local v
  if [ "${3:-}" = secret ]; then read -rsp "  $2: " v; echo; else read -rp "  $2: " v; fi
  [ -n "$v" ] && set_env "$1" "$v" "$([ "${3:-}" = secret ] && echo --sensitive)"
  return 0
}
ask SELLER_NAME "ФИО самозанятого, ИП или название ООО"
ask SELLER_INN "ИНН"
ask SUPPORT_EMAIL "Почта поддержки"
ask YOOKASSA_SHOP_ID "ЮKassa shopId"
ask YOOKASSA_SECRET_KEY "ЮKassa секретный ключ" secret
ask ANTHROPIC_API_KEY "Ключ Anthropic для питчей" secret

echo "4/4 Выкатка"
vercel deploy --prod --yes

cat <<EOF

Готово. Осталось вручную в панели Vercel:
  Project → Settings → Deployment Protection → отключить для Production.
В ЮKassa (Интеграция → HTTP-уведомления): $APP_URL/api/billing/yookassa, события payment.succeeded и payment.canceled.
EOF
