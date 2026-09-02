# Конфиги глубоких проб (scrape / forms / API / DB)

Каждый файл: `probes/<siteId>.json`.

После деплоя Big Brother подхватывает их автоматически. Секреты **не** клади в JSON —
только имена env (`urlEnv`, `env:TOKEN` в headers).

## Что умеет каждый тип

| Тип | Зачем |
|-----|--------|
| `pages` | Открыть URL, проверить селекторы/тексты, найти PHP/Next error в HTML, замерить TTFB/размер |
| `crawl` | Обойти внутренние ссылки (углы сайта), ловить 404/500 и error signatures |
| `assets` / `checkAssets` | CSS/JS/картинки: 404 и «тяжёлые для слабого интернета» (байт/мс бюджеты) |
| `forms` | `discover` — форма есть и action жив; `auto` — реальный POST + проверка ответа/SQL ошибок |
| `apis` | Синтетические API-вызовы (health, create test row, etc.) |
| `databases` | `postgres` / `mysql` / `http` — `SELECT 1` или свой query |

## Пример формы (реальный submit)

```json
{
  "name": "contact-form",
  "pagePath": "/contacts",
  "formSelector": "form#contact",
  "mode": "auto",
  "fields": {
    "name": "BigBrother Test",
    "email": "bb-test+{{timestamp}}@example.com",
    "message": "synthetic probe {{iso}}"
  },
  "expectStatus": [200, 302],
  "expectTextExcludes": "Fatal error",
  "severity": "critical"
}
```

## Пример БД

В Vercel env Big Brother:

```
DOCTOR_DATABASE_URL=mysql://user:pass@host:3306/dbname
DEAL_POIZON_DATABASE_URL=postgres://...
```

Проверка записи (если есть test-таблица):

```json
{
  "name": "orders-writable-check",
  "driver": "mysql",
  "urlEnv": "DOCTOR_DATABASE_URL",
  "query": "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE()",
  "expectRowsMin": 1
}
```

Для «в БД реально пишется» лучше API-проба на ваш test-endpoint, который делает insert+rollback/delete.

## Пример API с секретом

```json
{
  "name": "create-test-lead",
  "path": "/api/health/db-write",
  "method": "POST",
  "headers": {
    "Authorization": "env:DEAL_POIZON_INTERNAL_SECRET"
  },
  "body": { "ping": true },
  "expectStatus": [200],
  "expectJsonPath": "$.ok"
}
```

## Режимы cron / бота

- `mode=shallow` / `/check` — только HTTP
- `mode=deep` / `/deep` — pages + forms + api + db + assets (по умолчанию для cron)
- `mode=full` / `/full` — + crawl по ссылкам
