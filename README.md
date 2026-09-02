# Big Brother

Тотальный контроль сайтов на **Vercel Hobby** + Telegram. Не только «сайт открывается», а scrape углов, форм, ассетов (слабый интернет), API и БД.

## Слои проверки

1. **HTTP** — жив ли URL  
2. **HTML scrape (cheerio)** — селекторы/тексты + сигнатуры PHP/Next/SQL ошибок в HTML  
3. **Assets** — CSS/JS/img: 404 и бюджеты размера/времени (эвристика слабого интернета)  
4. **Crawl** — обход внутренних ссылок, поиск мёртвых углов  
5. **Forms** — форма на месте / action жив / реальный POST + ловля DB errors в ответе  
6. **API probes** — синтетические запросы к твоим endpoint’ам  
7. **DB probes** — MySQL / Postgres / HTTP health (секреты в env Big Brother)  
8. **SDK push** — runtime ошибки и failed fetch с самих сайтов → Telegram сразу  

Конфиги: [`probes/`](probes/) — см. [`probes/README.md`](probes/README.md).

## Сайты

| siteId | URL |
|--------|-----|
| `zvezda-na-elku` | https://звезда-на-елку.рф |
| `doctor-ekazheva` | https://doctor-ekazheva.ru |
| `kateramika` | https://kateramika.ru |
| `deal-poizon-delivery` | https://deal-poizon-delivery.vercel.app |

## Быстрый старт

1. Upstash Redis + Telegram bot (как раньше) — env из [`.env.example`](.env.example)  
2. Задеплой на Vercel  
3. Webhook бота → `/api/telegram?secret=...`  
4. **cron-job.org каждые 5 мин:**  
   `GET https://YOUR-APP.vercel.app/api/check?mode=deep`  
   Header: `Authorization: Bearer CRON_SECRET`  
5. Положи в Vercel env строки БД (`DOCTOR_DATABASE_URL`, …) — проверки включатся сами  
6. Допиши формы/селекторы/API в `probes/<siteId>.json` и задеплой снова  
7. SDK на сайты — [`sdk/README.md`](sdk/README.md)

## Telegram

| Команда | Действие |
|---------|----------|
| `/status` | Последние статусы |
| `/check [site]` | Быстрый HTTP |
| `/deep [site]` | Scrape + forms + API + DB |
| `/full [site]` | Deep + crawl по ссылкам |
| `/probes [site]` | Что настроено |
| `/errors` | История |
| `/mute` `/unmute` | Тишина |

Статусы: 🟢 up · 🟡 degraded (медленные/тяжёлые ассеты) · 🔴 down/critical probe fail.

## Секреты проектов

Можно отдать Big Brother любые данные — они живут только в **env Vercel этого монитора**:

```
ZVEZDA_DATABASE_URL=mysql://...
DOCTOR_DATABASE_URL=mysql://...
KATERAMIKA_DATABASE_URL=postgres://...
DEAL_POIZON_DATABASE_URL=postgres://...
DEAL_POIZON_INTERNAL_SECRET=...
```

В JSON пиши `"urlEnv": "DOCTOR_DATABASE_URL"` или header `"Authorization": "env:DEAL_POIZON_INTERNAL_SECRET"`.

## Почему не Puppeteer

Полноценный headless Chrome на Hobby дорогой и тяжёлый. Cheerio-scrape + синтетические POST/API/DB + SDK на клиенте дают 90% контроля без Pro-плана. Если позже понадобится реальный браузер — можно добавить Browserless как опциональный слой.

## API

| Путь | Назначение |
|------|------------|
| `/api/check?mode=deep\|full\|shallow&site=` | Прогон проб |
| `/api/report` | Push ошибок с сайтов |
| `/api/status` | JSON |
| `/api/telegram` | Бот |
