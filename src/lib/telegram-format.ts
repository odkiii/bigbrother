import type { ProbeFinding, ReportedError, SiteCheckResult } from "@/lib/types";

const KIND_RU: Record<string, string> = {
  http: "HTTP-запрос",
  page: "Страница",
  crawl: "Обход сайта",
  asset: "Статика (CSS/JS)",
  form: "Форма",
  api: "API",
  db: "База данных",
  html_error: "Ошибка в HTML",
};

const STATUS_RU: Record<string, string> = {
  up: "работает",
  down: "не работает",
  degraded: "частично сломан",
  unknown: "статус неизвестен",
};

function iconFor(status: string): string {
  if (status === "up") return "🟢";
  if (status === "degraded") return "🟡";
  if (status === "down") return "🔴";
  return "⚪";
}

function explainHttp(code: number | null): string {
  if (code == null) return "HTTP-код не получен (таймаут, DNS или сеть)";
  if (code >= 200 && code < 300) return `${code} — ответ успешен`;
  if (code === 301 || code === 302 || code === 307 || code === 308)
    return `${code} — редирект (проверь, что финальный URL открывается)`;
  if (code === 401 || code === 403)
    return `${code} — доступ запрещён (пароль, Cloudflare, IP-блок)`;
  if (code === 404) return `${code} — страница не найдена`;
  if (code === 429) return `${code} — слишком много запросов (rate limit)`;
  if (code >= 500)
    return `${code} — ошибка сервера / хостинга (часто Vercel/Onreza/PHP)`;
  return `${code} — неожиданный код ответа`;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta).slice(0, 6)) {
    const val =
      typeof v === "string"
        ? v.slice(0, 120)
        : typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : JSON.stringify(v).slice(0, 120);
    parts.push(`${k}=${val}`);
  }
  return parts.length ? `\n    лог: ${parts.join("; ")}` : "";
}

export function formatFinding(f: ProbeFinding): string {
  const kind = KIND_RU[f.kind] ?? f.kind;
  const sev = f.severity === "critical" ? "критично" : "предупреждение";
  const mark = f.ok ? "✓" : f.severity === "critical" ? "✗" : "!";
  const lat = f.latencyMs != null ? ` · ${f.latencyMs}ms` : "";
  const url = f.url ? `\n    url: ${f.url}` : "";
  return `${mark} [${kind}/${sev}] ${f.name}${lat}\n    ${f.message}${url}${formatMeta(f.meta)}`;
}

/** Detailed single-site check report for Telegram. */
export function formatDetailedCheckReport(
  result: SiteCheckResult,
  siteName?: string,
): string {
  const name = siteName ?? result.siteId;
  const lines: string[] = [
    `${iconFor(result.status)} ${name}`,
    `статус: ${STATUS_RU[result.status] ?? result.status}`,
    `url: ${result.url}`,
    `http: ${explainHttp(result.httpStatus)}`,
    `latency: ${result.latencyMs ?? "?"} ms`,
    `проверено: ${result.checkedAt}`,
  ];

  if (result.probeSummary) {
    const s = result.probeSummary;
    lines.push(
      `пробы: всего ${s.total}, ошибок ${s.failed}, предупреждений ${s.warnings}`,
    );
  }

  if (result.error) {
    lines.push("", "сводка ошибки:", result.error.slice(0, 500));
  }

  const findings = result.findings ?? [];
  const failed = findings.filter((f) => !f.ok);
  const okOnes = findings.filter((f) => f.ok);

  if (failed.length > 0) {
    lines.push("", "что сломалось:");
    for (const f of failed.slice(0, 12)) {
      lines.push(formatFinding(f));
    }
    if (failed.length > 12) {
      lines.push(`…ещё ${failed.length - 12} проблем`);
    }
  }

  if (okOnes.length > 0 && findings.length <= 16) {
    lines.push("", "что прошло:");
    for (const f of okOnes.slice(0, 8)) {
      lines.push(formatFinding(f));
    }
  } else if (okOnes.length > 0) {
    lines.push("", `успешных проб: ${okOnes.length}`);
  }

  if (result.status === "down") {
    lines.push(
      "",
      "что делать:",
      "• открой url в браузере и сравни с логом выше",
      "• если 5xx — смотри логи хостинга (Vercel/Onreza)",
      "• если DNS/таймаут — проверь домен и оплату хостинга",
      "• кнопка «ещё раз» ниже повторит глубокую проверку",
    );
  }

  return lines.join("\n");
}

export function formatStatusLine(
  result: SiteCheckResult | null,
  name: string,
): string {
  if (!result) return `⚪ ${name}: ещё не проверялся`;
  const sum = result.probeSummary
    ? ` · fail ${result.probeSummary.failed}/warn ${result.probeSummary.warnings}`
    : "";
  const err = result.error ? `\n  ${result.error.slice(0, 160)}` : "";
  return `${iconFor(result.status)} ${name}: ${STATUS_RU[result.status] ?? result.status}${sum} · ${result.latencyMs ?? "?"}ms · ${result.checkedAt}${err}`;
}

export function formatErrorDetailed(e: ReportedError): string {
  const lines = [
    `• [${e.siteId}] источник: ${e.source}`,
    `  время: ${e.receivedAt}`,
    `  сообщение: ${e.message.slice(0, 400)}`,
  ];
  if (e.url) lines.push(`  url: ${e.url}`);
  if (e.stack) lines.push(`  stack:\n${e.stack.slice(0, 800)}`);
  if (e.meta && Object.keys(e.meta).length) {
    lines.push(`  meta: ${JSON.stringify(e.meta).slice(0, 400)}`);
  }
  lines.push(`  id: ${e.id}`);
  return lines.join("\n");
}

export function formatDowntimeHuman(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h <= 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

export const HELP_TEXT = [
  "👁 Big Brother — мониторинг твоих сайтов",
  "",
  "Команды:",
  "/start — меню с кнопками",
  "/help — это описание",
  "/status — последние статусы всех сайтов",
  "/sites — список + кнопки проверки / удаления",
  "/check [id] — быстрый HTTP-пинг",
  "/deep [id] — глубокая проверка (страницы, формы, API, БД)",
  "/full [id] — deep + обход внутренних ссылок",
  "/probes [id] — что настроено для сайта",
  "/errors [n] — последние ошибки с логами",
  "/add — добавить сайт в мониторинг (по шагам)",
  "/remove [id] — убрать сайт из мониторинга",
  "/mute <id> [мин] — временно не слать алерты",
  "/unmute <id> — снова слать алерты",
  "/chatid — показать chat id (для TELEGRAM_CHAT_ID)",
  "",
  "Уведомления в личку (TELEGRAM_CHAT_ID):",
  "• сразу при падении / деградации / восстановлении",
  "• эскалация, если сайт лежит уже 1ч / 3ч / 6ч / 12ч",
  "",
  "Кнопки под сообщениями — проверка одного сайта,",
  "добавление и удаление без ручного ввода id.",
].join("\n");
