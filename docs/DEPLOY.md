# Деплой на Vercel

Проект уже создан и задеплоен: `qcom666/findwork`, адрес https://findwork-rouge.vercel.app. Пока на нём заглушка «Сайт настраивается»:
нет баз данных, а на Vercel нельзя хранить SQLite-файлы (диск только для чтения). Поэтому обе базы переезжают в Turso
(тот же SQLite-протокол, бесплатный тариф). Локально ничего не меняется: там по-прежнему файлы.

Быстрый путь: `turso auth login`, затем `scripts/setup-prod.sh`. Скрипт сам создаёт базы, кладёт переменные в Vercel и выкатывает. Ниже то же вручную.

## 1. Базы в Turso

```bash
brew install tursodatabase/tap/turso
turso auth login

# каталог заведений: загружаем готовый файл, который собрал ingest/build_db.py
turso db create findwork-leads
SRC=data/leads.db DEST_URL=<url> DEST_TOKEN=<token> node scripts/push-leads.mjs   # --from-file в CLI не принимает наш файл
# аккаунты, кредиты, платежи: пустая база, таблицы приложение создаст само
turso db create findwork-app

turso db show findwork-leads --url        # libsql://findwork-leads-<логин>.turso.io
turso db tokens create findwork-leads
turso db show findwork-app --url
turso db tokens create findwork-app
```


## 2. Переменные окружения

Секреты задавайте только в Vercel, в репозиторий они не попадают.

```bash
vercel env add LEADS_DB_URL production          # libsql://findwork-leads-...
vercel env add LEADS_DB_AUTH_TOKEN production
vercel env add APP_DB_URL production            # libsql://findwork-app-...
vercel env add APP_DB_AUTH_TOKEN production
vercel env add APP_URL production               # https://ваш-домен, без слеша в конце
vercel env add SELLER_NAME production           # ФИО самозанятого, ИП или название ООО
vercel env add SELLER_INN production
vercel env add SUPPORT_EMAIL production
vercel env add ANTHROPIC_API_KEY production     # для питчей от Claude, можно позже
vercel env add ADMIN_EMAILS production          # ваш e-mail из аккаунта Lidomap: откроет страницу /admin с метриками
```

## 3. ЮKassa

1. В личном кабинете ЮKassa создайте магазин и возьмите shopId и секретный ключ. Пока магазин в тестовом режиме, платежи тоже тестовые.
2. `vercel env add YOOKASSA_SHOP_ID production` и `YOOKASSA_SECRET_KEY`.
3. Интеграция → HTTP-уведомления: адрес `https://ваш-домен/api/billing/yookassa`, события `payment.succeeded` и `payment.canceled`.
4. ИП и ООО с «Чеками от ЮKassa»: `YOOKASSA_RECEIPT=1` (и при необходимости `YOOKASSA_TAX_SYSTEM`). Самозанятому чек формирует «Мой налог», флаг не нужен.
5. ЮKassa проверяет сайт перед боевым режимом: нужны оферта, реквизиты и контакты (страницы `/terms` и `/privacy`, поля из шага 2), цены и описание услуги. Тексты оферты показаны как шаблон: покажите их юристу.

## 4. Доступ к сайту

* **Deployment Protection.** По умолчанию Vercel закрывает деплои входом в аккаунт Vercel. Для публичного сайта и для вебхуков ЮKassa отключите защиту у Production: Project → Settings → Deployment Protection.
* **Тариф.** Hobby разрешён только для некоммерческого использования. Для приёма платежей нужен Pro.
* **Домен.** Project → Settings → Domains. После подключения обновите `APP_URL` и адрес вебхука в ЮKassa.
* **Прокси в России.** Посетители из РФ без VPN до Vercel почти не доходят (соединение обрывается на ~16 КБ), поэтому `lidomap.ru` смотрит на сервер в Москве с nginx, который пересылает запросы на Vercel с Host `lidomap.ru`. Конфиг и установка: `deploy/proxy/lidomap.conf`, `deploy/proxy/setup.sh base|tls`; секрет для настоящего IP посетителя: `scripts/proxy-secret.sh`. Адреса Vercel в конфиге заданы явно: если какой-то перестанет отвечать из Москвы, замените его.

## 5. Выкатка

Репозиторий https://github.com/qcom666/findwork связан с проектом Vercel: пуш в `main` сам выкатывает production, пуш в другую ветку или pull request даёт превью-деплой.
Ручной запуск при необходимости: `vercel deploy --prod`.

## Обновление каталога заведений

Файл `leads.db` меняется при каждой пересборке. Не перезаписывайте рабочую базу: создайте новую (`turso db create findwork-leads-2`, затем `scripts/push-leads.mjs`), проверьте, поменяйте `LEADS_DB_URL` и `LEADS_DB_AUTH_TOKEN` и выкатите заново. Аккаунты лежат в другой базе и не затрагиваются, но идентификаторы лидов (`unlocks.lead_id`) берутся из Overture: после смены релиза часть старых идентификаторов может пропасть, и такие «открытые» лиды перестанут находиться.
