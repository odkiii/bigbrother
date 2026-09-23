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
4. **Постоянный cron каждые 5 мин** — GitHub Actions (`.github/workflows/health-check.yml`):
   - Auth через **GitHub OIDC** (Actions secret не нужен). Опционально: repo secret `CRON_SECRET` = Vercel Production
   - Actions → «Health check cron» → Run workflow
5. Vercel Cron (Hobby) — раз в сутки `0 6 * * *` UTC на `/api/check?mode=deep` (Bearer `CRON_SECRET` шлётся сам)
6. Положи в Vercel env строки БД (`DOCTOR_DATABASE_URL`, …) — проверки включатся сами  
7. Допиши формы/селекторы/API в `probes/<siteId>.json` и задеплой снова  
8. SDK на сайты — [`sdk/README.md`](sdk/README.md)

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

### Если бот молчит

Проверено по живому деплою: GitHub homepage `https://bigbrother-phi.vercel.app` сейчас отдаёт Vercel `DEPLOYMENT_NOT_FOUND`. Живые `*.vercel.app` URL проекта закрыты **Vercel Deployment Protection (SSO)** — `POST /api/telegram` возвращает `401 Protected deployment`. Telegram не умеет ходить через Vercel login, поэтому webhook не доходит.

Что сделать в Vercel (Production):

1. Повесить рабочий Production Domain (не мёртвый alias) и прописать его в `BIGBROTHER_PUBLIC_URL`.
2. Либо выключить Deployment Protection для Production, либо включить **Protection Bypass for Automation** (появится `VERCEL_AUTOMATION_BYPASS_SECRET`). Код сам добавит `?x-vercel-protection-bypass=` в URL вебхука.
3. Env: `TELEGRAM_BOT_TOKEN` обязательно; `TELEGRAM_CHAT_ID` для алертов; `TELEGRAM_WEBHOOK_SECRET` только из `A-Za-z0-9_-`.
4. После деплоя зарегистрировать вебхук (тот же секрет, что `CRON_SECRET`):

```bash
curl "https://YOUR-APP.vercel.app/api/telegram?secret=CRON_SECRET"
```

Ответ покажет `ensure`, `probe.protection`, `deploymentMissing`, `lastError`. Дальше `/start` боту.

Запасной канал, если webhook всё ещё режется: cron каждую минуту на `GET /api/telegram/poll?secret=CRON_SECRET` (getUpdates). Нельзя одновременно с рабочим webhook.

### Если `*.vercel.app` отдаёт platform `404 NOT_FOUND`

Билд при этом может быть зелёным (`ƒ /`, `/api/telegram` в логе). Это **не** «пропала page.tsx» — edge Vercel не матчит hostname на deployment.

1. **Deployment Protection → Require Log In = OFF** для Production.
2. Проверь диагностику после деплоя:
   - `https://YOUR-DOMAIN/ok.txt` → должно быть `bigbrother-ok`
   - `https://YOUR-DOMAIN/api/ping` → JSON `{ ok: true, service: "bigbrother", ... }`
3. Если оба 404 при Valid Configuration: в Vercel **Settings → General → Project Name** переименуй проект (например `bigbrother-monitor`) — появится новый `*.vercel.app`. Старый `bigbrother-iswu` удали из Domains. Пропиши новый URL в `BIGBROTHER_PUBLIC_URL` и Redeploy.
4. Либо повесь свой custom domain (DNS A/CNAME на Vercel) вместо сломанного alias.

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
| `/api/telegram` | Бот (POST webhook; GET + secret = диагностика и setWebhook) |
| `/api/telegram/poll` | Fallback getUpdates (нужен `CRON_SECRET`) |
| `/api/ping` | Публичный liveness JSON (без секрета) |
| `/ok.txt` | Статический маркер `bigbrother-ok` |
