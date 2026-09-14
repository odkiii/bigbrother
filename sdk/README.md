# Big Brother SDK — подключение к сайтам

Скопируй [`bigbrother.ts`](./bigbrother.ts) в каждый проект (например `src/lib/bigbrother.ts`).

## Важно про секрет

`REPORT_SECRET` нельзя светить в браузере. Для клиентских ошибок сделай тонкий прокси на самом сайте:

```ts
// app/api/bb-report/route.ts  (на КАЖДОМ мониторимом Next.js сайте)
export async function POST(req: Request) {
  const body = await req.json();
  await fetch(process.env.BIGBROTHER_URL + "/api/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.BIGBROTHER_REPORT_SECRET}`,
    },
    body: JSON.stringify({ ...body, siteId: process.env.BIGBROTHER_SITE_ID }),
  });
  return Response.json({ ok: true });
}
```

Клиент:

```ts
"use client";
import { useEffect } from "react";
import { initBigBrother } from "@/lib/bigbrother";

export function BigBrotherProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initBigBrother({
      endpoint: "/api/bb-report",
      secret: "proxy", // прокси сам добавит настоящий Bearer
      siteId: "unused-overridden-by-proxy",
    });
  }, []);
  return children;
}
```

Если прокси перезаписывает `siteId` и сам ставит Authorization, подправь SDK `reportError`, чтобы не требовать secret на клиенте — или передай dummy secret и в прокси игнорируй входящий Authorization.

Проще: в прокси-роуте выше не читай secret с клиента, а всегда подставляй серверный.

Минимальный клиентский вызов без SDK:

```ts
window.addEventListener("error", (e) => {
  fetch("/api/bb-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: e.message,
      stack: e.error?.stack,
      url: location.href,
      source: "client",
    }),
    keepalive: true,
  });
});
```

## siteId для текущих проектов

| Сайт | siteId |
|------|--------|
| звезда-на-елку.рф | `zvezda-na-elku` |
| doctor-ekazheva.ru | `doctor-ekazheva` |
| kateramika.ru | `kateramika` |
| deal-poizon-delivery.vercel.app | `deal-poizon-delivery` |
| droptext.site | `droptext` |

Для Onreza (PHP/статик) — тот же JS-сниппет в `<script>`, прокси не обязателен, если готов принять риск публичного report endpoint с rate-limit (лучше короткий secret + CORS restrict).
