# Big Brother

Лёгкий монитор всех твоих сайтов + Telegram-бот. Крутится на **Vercel Hobby** без Pro Log Drains и без частого Vercel Cron.

## Что умеет

1. **Health-check** каждые ~5 минут (внешний free-cron → `/api/check`) — сайт жив / упал / ожил  
2. **Приём ошибок** с сайтов (`POST /api/report`) — runtime JS / сервер → Telegram за секунды (дедуп 5 мин)  
3. **Telegram-бот**: `/status`, `/check`, `/errors`, `/mute`, …  
4. Минимальная веб-страница со статусами (опционально)

### Сайты из коробки

| siteId | URL | Хостинг |
|--------|-----|---------|
| `zvezda-na-elku` | https://звезда-на-елку.рф | Onreza |
| `doctor-ekazheva` | https://doctor-ekazheva.ru | Onreza |
| `kateramika` | https://kateramika.ru | — |
| `deal-poizon-delivery` | https://deal-poizon-delivery.vercel.app | Vercel |

Добавить ещё: правка `src/lib/sites.ts` или env `SITES_JSON`.

## Почему так (дешево и без лимитов Hobby)

- На Hobby **нельзя** читать логи всех проектов в реальном времени  
- Vercel Cron на Hobby — **раз в сутки** → для 5 минут используем бесплатный [cron-job.org](https://cron-job.org) (или аналог), который дергает `/api/check`  
- Хранилище: **Upstash Redis free** (~10k команд/день хватает с запасом)  
- Без отдельного сервера, без Docker

## Быстрый старт

### 1. Upstash Redis (2 минуты)

1. https://console.upstash.com → Create Database → Regional  
2. Скопируй `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`

### 2. Telegram-бот

1. @BotFather → `/newbot` → получи `TELEGRAM_BOT_TOKEN`  
2. Напиши боту `/start`, затем `/chatid` (после деплоя) **или** временно узнай chat id через `@userinfobot`  
3. Поставь `TELEGRAM_CHAT_ID`  
4. (Рекомендуется) `TELEGRAM_ALLOW_USER_IDS=твой_user_id`

### 3. Секреты

Сгенерируй длинные строки:

```bash
openssl rand -hex 32   # CRON_SECRET
openssl rand -hex 32   # REPORT_SECRET
openssl rand -hex 16   # TELEGRAM_WEBHOOK_SECRET
```

### 4. Деплой на Vercel

```bash
npm i
vercel
```

Env vars в Vercel Project Settings:

```
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
TELEGRAM_ALLOW_USER_IDS
TELEGRAM_WEBHOOK_SECRET
CRON_SECRET
REPORT_SECRET
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

### 5. Webhook Telegram

После деплоя (подставь свой домен и secret):

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://YOUR-APP.vercel.app/api/telegram?secret=TELEGRAM_WEBHOOK_SECRET"
```

### 6. Cron каждые 5 минут

На [cron-job.org](https://cron-job.org) (free):

- URL: `https://YOUR-APP.vercel.app/api/check`
- Method: `GET`
- Header: `Authorization: Bearer <CRON_SECRET>`
- Schedule: every 5 minutes

Раз в сутки дополнительно сработает нативный Vercel Cron (`vercel.json`) — запасной канал.

### 7. SDK на сайты (чтобы ловить runtime-ошибки)

См. [sdk/README.md](sdk/README.md). Без SDK Big Brother всё равно пингует URL и пишет в Telegram при дауне.

## Команды бота

| Команда | Действие |
|---------|----------|
| `/status` | Последние статусы |
| `/check` | Прогнать проверки сейчас |
| `/errors [n]` | Последние runtime-ошибки |
| `/sites` | Список siteId |
| `/mute <siteId> [min]` | Заглушить алерты |
| `/unmute <siteId>` | Снять mute |
| `/chatid` | Показать chat/user id |
| `/help` | Справка |

## API

| Метод | Путь | Auth | Назначение |
|-------|------|------|------------|
| GET/POST | `/api/check` | `Bearer CRON_SECRET` | Health sweep + алерты |
| POST | `/api/report` | `Bearer REPORT_SECRET` | Приём ошибки с сайта |
| GET | `/api/status` | — | JSON статусов |
| POST | `/api/telegram` | `?secret=` | Webhook бота |

## Локально

```bash
cp .env.example .env.local
# заполни env
npm run dev
```

Проверка:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/check
```

## Лимиты / антиспам

- Повторный алерт «сайт лежит» — не чаще чем раз в **15 мин** (пока не ожил)  
- Runtime-ошибка с тем же текстом — дедуп **5 мин**  
- `/mute` глушит сайт на N минут
