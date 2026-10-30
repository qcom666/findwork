#!/usr/bin/env bash
# Ключ доставки для ежедневной сборки каталога: GitHub Actions кладёт им свежую базу на сервер в Москве. Запускает владелец один раз.
# Ключ создаётся здесь, его закрытая часть уходит только в секреты репозитория (gh secret set) и с диска удаляется.
# На сервере ключ ограничен command= скриптом приёма базы: войти с ним, выполнить команду или что-то прочитать нельзя.
#   bash scripts/setup-catalog-deploy.sh
set -euo pipefail
HOST=${SERVER_HOST:-root@89.111.175.104}
KEY=${SERVER_KEY:-$HOME/.ssh/lidomap_proxy}
REPO=${REPO:-qcom666/findwork}
ssh_() { ssh -i "$KEY" -o BatchMode=yes "$HOST" "$@"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ssh-keygen -q -t ed25519 -N "" -C lidomap-catalog -f "$tmp/key"

# Открытая часть ключа на сервер, с ограничением: только приём каталога. Прежний ключ доставки, если был, заменяется.
ssh_ 'set -e; read -r pub; f=/root/.ssh/authorized_keys; tmp=$(mktemp); grep -v "lidomap-catalog" "$f" > "$tmp" || true;
  printf "command=\"/srv/lidomap/bin/import-leads.sh\",restrict %s\n" "$pub" >> "$tmp"; install -m 600 "$tmp" "$f"; rm -f "$tmp"' < "$tmp/key.pub"

# Отпечаток сервера берём с самого сервера (по уже доверенному соединению), чтобы Actions не подключились к подменённому.
ssh_ 'cat /etc/ssh/ssh_host_ed25519_key.pub' | awk -v h="${HOST#*@}" '{print h, $1, $2}' > "$tmp/known_hosts"

gh secret set CATALOG_SSH_KEY -R "$REPO" < "$tmp/key"
gh secret set CATALOG_KNOWN_HOSTS -R "$REPO" < "$tmp/known_hosts"
gh variable set CATALOG_HOST -R "$REPO" -b "$HOST"
echo "Готово: ключ доставки на сервере, секреты в GitHub. Закрытый ключ с диска удалён."
