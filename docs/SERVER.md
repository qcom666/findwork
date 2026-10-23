# Сайт на сервере в Москве

С 23.10.2026 lidomap.ru работает на своём сервере, а не на Vercel. Из России Vercel почти недоступен (соединения обрываются на ~16 КБ), а через прокси он видел всех посетителей с одного адреса и включал проверку на бота для всего сайта.

* **Сервер:** Рег.облако, Москва, `89.111.175.104` (тариф Std C1-M1-D10: 1 ядро, 1 ГБ, 10 ГБ, плюс swap 2 ГБ для сборки), Ubuntu 26.04. Вход: `ssh -i ~/.ssh/lidomap_proxy root@89.111.175.104`.
* **Как устроено:** nginx (TLS Let's Encrypt, лимиты, fail2ban, `deploy/proxy/`) → Next.js на `127.0.0.1:3000` (служба `lidomap`, пользователь `lidomap`, код в `/srv/lidomap/current`) → базы-файлы SQLite в `/var/lib/lidomap` (`leads.db` каталог, `app.db` аккаунты).
* **Настройки:** `/etc/lidomap/env` (root:lidomap 640). Ключи (`TELEGRAM_BOT_TOKEN`, `YOOKASSA_SECRET_KEY`) владелец вводит сам: `bash scripts/server-secrets.sh`.

## Выкладка

```bash
bash scripts/deploy-server.sh          # код последнего коммита: сборка на сервере ~2 минуты, затем перезапуск
bash scripts/deploy-server.sh leads    # новый каталог data/leads.db после пересборки (ingest/)
bash scripts/deploy-server.sh setup    # обновить службу, сборку и бэкап из deploy/server/
```

Если новый выпуск не ответил за минуту, `release.sh` сам возвращает прошлый. Хранятся три последних выпуска в `/srv/lidomap/releases`; откат вручную: `ln -sfn <выпуск> /srv/lidomap/current && systemctl restart lidomap`.

Пуш в `main` по-прежнему выкладывает и копию на Vercel (см. ниже), на сервер код попадает только этим скриптом.

## Бэкапы

Каждый день в 03:30 по Москве `lidomap-backup.timer` копирует `app.db` в `/var/backups/lidomap` (сжатые, 14 дней). Копии лежат на том же сервере: от поломки сервера целиком спасают только снимки в панели Рег.облака («Резервное копирование» у сервера, около 5 ₽ в месяц за гигабайт) или копия на другой машине. Каталог не копируется: он пересобирается из открытых данных.

## Telegram и ЮKassa

* **Telegram из России недоступен** (`api.telegram.org` не отвечает с сервера). Поэтому сервер шлёт запросы к Bot API через копию на Vercel (`TELEGRAM_API_URL=https://findwork-rouge.vercel.app/api/tg-relay`, там `TELEGRAM_RELAY=1`), а вебхук бота смотрит на Vercel (`TELEGRAM_WEBHOOK_BASE`), который пересылает его на сервер (`FORWARD_WEBHOOKS_TO=https://lidomap.ru`). Сайт сам подключает вебхук при первом входе через бота.
* **ЮKassa** доступна напрямую. Уведомления, которые приходят на старый адрес `findwork-rouge.vercel.app/api/billing/yookassa`, Vercel пересылает на сервер; в кабинете ЮKassa можно сменить адрес на `https://lidomap.ru/api/billing/yookassa`.

## Копия на Vercel

Проект Vercel `findwork` остался: старый адрес перенаправляет на lidomap.ru, пересылает вебхуки и запросы к Telegram. В его настройках по-прежнему базы Turso, но там старые данные на момент переезда. Если сервер выйдет из строя надолго: залить свежий бэкап `app.db` в Turso, переключить в nginx на `deploy/proxy/lidomap-vercel.conf` или вернуть DNS `lidomap.ru` на Vercel (`vercel dns rm` для A-записей) и задать `PD_RU_HOST` пустым, потому что данные снова окажутся за границей.
