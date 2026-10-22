#!/usr/bin/env bash
# Общий секрет между прокси lidomap.ru и сайтом на Vercel. По нему сайт верит адресу посетителя, который передаёт прокси
# (лимиты на вход и регистрацию считаются по этому адресу). Секрет нигде не печатается: уходит сразу в Vercel и на сервер.
# Запуск из папки проекта: bash scripts/proxy-secret.sh   (нужны вход в Vercel CLI и ключ ~/.ssh/lidomap_proxy)
set -euo pipefail
HOST=${PROXY_HOST:-root@89.111.175.104}
KEY=${PROXY_KEY:-$HOME/.ssh/lidomap_proxy}

SECRET=$(openssl rand -hex 32)
npx vercel env add PROXY_SECRET production --sensitive --force --value "$SECRET" --yes >/dev/null
printf 'proxy_set_header X-Lidomap-Proxy "%s";\n' "$SECRET" |
  ssh -i "$KEY" "$HOST" 'umask 077 && cat > /etc/nginx/lidomap-secret.conf && nginx -t -q && systemctl reload nginx'
echo "Готово: секрет записан в Vercel и на сервер."
