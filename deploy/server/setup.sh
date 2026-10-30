#!/usr/bin/env bash
# Сайт Lidomap на сервере в Москве (запускать от root, повторный запуск безопасен):
# Node 22, пользователь lidomap, swap для сборки, служба сайта, ежедневный бэкап базы аккаунтов.
# Переменные окружения лежат в /etc/lidomap/env (root:lidomap 640), ключи туда пишет scripts/server-secrets.sh.
set -euo pipefail
cd "$(dirname "$0")"

NODE=v22.23.4
NODE_SHA256=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
if [ "$(/usr/local/bin/node -v 2>/dev/null)" != "$NODE" ]; then
  curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/$NODE/node-$NODE-linux-x64.tar.xz"
  echo "$NODE_SHA256  /tmp/node.tar.xz" | sha256sum -c -
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 && rm /tmp/node.tar.xz
  for b in node npm npx; do ln -sf "/opt/node/bin/$b" "/usr/local/bin/$b"; done
fi

DEBIAN_FRONTEND=noninteractive apt-get install -yq sqlite3 zstd >/dev/null

# К Telegram сервер ходит через копию на Vercel (api.telegram.org из России недоступен). Один из адресов Vercel
# (64.29.17.67) отсюда не отвечает, поэтому имя закрепляем за рабочими адресами: Vercel отдаёт проект с любого своего адреса.
if ! grep -q 'findwork-rouge.vercel.app' /etc/hosts; then
  printf '216.198.79.1 findwork-rouge.vercel.app\n216.198.79.65 findwork-rouge.vercel.app\n' >> /etc/hosts
fi

# Сборке Next.js не хватает 1 ГБ памяти: swap на 2 ГБ.
if ! swapon --show | grep -q /swapfile; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id lidomap >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/lidomap --shell /usr/sbin/nologin lidomap
mkdir -p /srv/lidomap/releases /srv/lidomap/bin /var/lib/lidomap /var/backups/lidomap /etc/lidomap
chown lidomap:lidomap /srv/lidomap/releases /var/lib/lidomap
chmod 700 /var/backups/lidomap
if [ ! -f /etc/lidomap/env ]; then install -m 640 -g lidomap /dev/null /etc/lidomap/env; fi

install -m 755 release.sh backup.sh import-leads.sh /srv/lidomap/bin/
install -m 644 lidomap.service lidomap-backup.service lidomap-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable lidomap.service >/dev/null
systemctl enable --now lidomap-backup.timer >/dev/null
echo "готово: node $(/usr/local/bin/node -v), npm $(/usr/local/bin/npm -v)"
