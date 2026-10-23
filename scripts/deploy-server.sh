#!/usr/bin/env bash
# Выкладка сайта на сервер в Москве: код последнего коммита уходит на сервер, там собирается и включается
# (deploy/server/release.sh; если новый выпуск не поднялся, сервер сам вернёт прошлый).
#   bash scripts/deploy-server.sh          выложить код
#   bash scripts/deploy-server.sh setup    обновить на сервере службу, скрипты сборки и бэкапа (deploy/server/)
#   bash scripts/deploy-server.sh leads    залить каталог заведений data/leads.db (после пересборки каталога)
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=${SERVER_HOST:-root@89.111.175.104}
KEY=${SERVER_KEY:-$HOME/.ssh/lidomap_proxy}
ssh_() { ssh -i "$KEY" -o BatchMode=yes "$HOST" "$@"; }

case "${1:-code}" in
  setup)
    tar -C deploy/server -cf - . | ssh_ "rm -rf /root/lidomap-server && mkdir -p /root/lidomap-server && tar -x -C /root/lidomap-server && bash /root/lidomap-server/setup.sh"
    ;;
  leads)
    [ -f data/leads.db ] || { echo "нет data/leads.db" >&2; exit 1; }
    scp -i "$KEY" -o BatchMode=yes data/leads.db "$HOST:/var/lib/lidomap/leads.db.new"
    # Подмена файла целиком: сайт откроет новую базу после перезапуска, старая не портится на ходу.
    ssh_ "cd /var/lib/lidomap && sqlite3 leads.db.new 'PRAGMA integrity_check; ANALYZE;' | head -1 | grep -qx ok \
      && chown lidomap:lidomap leads.db.new && mv -f leads.db.new leads.db && systemctl restart lidomap && echo 'каталог обновлён'"
    ;;
  code)
    SHA=$(git rev-parse --short HEAD)
    [ -z "$(git status --porcelain --untracked-files=no)" ] || echo "Внимание: незакоммиченные изменения не попадут на сервер, выкладывается коммит $SHA"
    REL="/srv/lidomap/releases/$(date +%Y%m%d-%H%M%S)-$SHA"
    git archive --format=tar HEAD | ssh_ "mkdir -p '$REL' && tar -x -C '$REL' && chown -R lidomap:lidomap '$REL'"
    ssh_ "bash /srv/lidomap/bin/release.sh '$REL'"
    ;;
  *)
    echo "usage: bash scripts/deploy-server.sh [code|setup|leads]" >&2
    exit 1
    ;;
esac
