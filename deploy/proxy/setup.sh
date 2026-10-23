#!/usr/bin/env bash
# Настройка прокси lidomap.ru на чистом Ubuntu (запускать на сервере от root).
#   bash setup.sh base   nginx, certbot и временный конфиг на 80 порту, чтобы выпустить сертификат
#   bash setup.sh tls    сертификат Let's Encrypt для lidomap.ru и www (DNS уже должен смотреть на сервер) и боевой конфиг
set -euo pipefail
cd "$(dirname "$0")"

case "${1:-}" in
  base)
    apt-get update -q
    DEBIAN_FRONTEND=noninteractive apt-get install -yq nginx certbot fail2ban
    install -m 644 fail2ban/lidomap-scan.filter.conf /etc/fail2ban/filter.d/lidomap-scan.conf
    install -m 644 fail2ban/lidomap.jail.conf /etc/fail2ban/jail.d/lidomap.conf
    systemctl enable --now fail2ban && systemctl restart fail2ban
    mkdir -p /var/www/acme /var/cache/nginx/lidomap
    [ -f /etc/nginx/lidomap-secret.conf ] || install -m 600 /dev/null /etc/nginx/lidomap-secret.conf
    rm -f /etc/nginx/sites-enabled/default
    # Версию nginx в ответах не показываем (в Ubuntu по умолчанию server_tokens build).
    sed -i -E 's/^(\s*)server_tokens [a-z]+;/\1server_tokens off;/' /etc/nginx/nginx.conf
    cat > /etc/nginx/sites-enabled/lidomap.conf <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name lidomap.ru www.lidomap.ru;
    location /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { return 503 "lidomap proxy: TLS ещё не настроен\n"; }
}
EOF
    nginx -t && systemctl reload nginx
    ;;
  tls)
    certbot certonly --webroot -w /var/www/acme -d lidomap.ru -d www.lidomap.ru \
      --non-interactive --agree-tos --register-unsafely-without-email \
      --deploy-hook "systemctl reload nginx"
    install -m 644 lidomap.conf /etc/nginx/sites-enabled/lidomap.conf
    nginx -t && systemctl reload nginx
    ;;
  *)
    echo "usage: bash setup.sh base|tls" >&2
    exit 1
    ;;
esac
