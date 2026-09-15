import {
  claimDedupe,
  clearDownSince,
  getDownSince,
  getSiteStatus,
  isMuted,
  markDownSince,
  pushError,
  saveSiteStatus,
} from "@/lib/redis";
import { getSiteByIdManaged } from "@/lib/sites";
import { formatDowntimeHuman } from "@/lib/telegram-format";
import { sendTelegramMessage } from "@/lib/telegram";
import type {
  ReportedError,
  SiteCheckResult,
  SiteConfig,
} from "@/lib/types";
import {
  runAllSiteProbes,
  type DeepRunOptions,
} from "@/lib/probes/runner";
import { randomUUID } from "crypto";

const DOWN_DEDUPE_SEC = 15 * 60;
const DEGRADED_DEDUPE_SEC = 20 * 60;
const ERROR_DEDUPE_SEC = 5 * 60;

/** Escalate private alerts after continuous downtime. */
const ESCALATION_HOURS = [1, 3, 6, 12] as const;
/** Keep escalation dedupe long enough to not re-fire until recovered. */
const ESCALATION_DEDUPE_SEC = 14 * 24 * 60 * 60;

export async function runHealthSweep(
  sites: SiteConfig[],
  options: DeepRunOptions = { mode: "deep" },
): Promise<{
  results: SiteCheckResult[];
  alertsSent: number;
}> {
  const results = await runAllSiteProbes(sites, options);
  let alertsSent = 0;

  for (const result of results) {
    const previous = await getSiteStatus(result.siteId);
    await saveSiteStatus(result);

    const muted = await isMuted(result.siteId);
    const site = sites.find((s) => s.id === result.siteId);
    const name = site?.name ?? result.siteId;
    const summary = result.probeSummary
      ? `пробы: ${result.probeSummary.total}, ошибок: ${result.probeSummary.failed}, предупр.: ${result.probeSummary.warnings}`
      : "";

    if (result.status === "down") {
      const downSince = await markDownSince(result.siteId, result.checkedAt);

      if (!muted) {
        const key = `down:${result.siteId}:${hashLite(result.error ?? "down")}`;
        const fresh = await claimDedupe(key, DOWN_DEDUPE_SEC);
        const wasOk =
          !previous ||
          previous.status === "up" ||
          previous.status === "degraded";
        if (fresh || wasOk) {
          const details = (result.findings ?? [])
            .filter((f) => !f.ok)
            .slice(0, 8)
            .map(
              (f) =>
                `• [${f.kind}/${f.severity}] ${f.name}: ${f.message}${
                  f.url ? `\n  ${f.url}` : ""
                }`,
            )
            .join("\n");
          const ok = await sendTelegramMessage(
            [
              `🔴 ПРОБЛЕМА: ${name}`,
              `url: ${result.url}`,
              summary,
              details || `ошибка: ${result.error ?? "неизвестно"}`,
              `http: ${result.httpStatus ?? "нет ответа"}`,
              `latency: ${result.latencyMs ?? "?"}ms`,
              `с: ${downSince}`,
              `at: ${result.checkedAt}`,
              "",
              "Подробности: /deep " + result.siteId,
            ].join("\n"),
          );
          if (ok.ok) alertsSent += 1;

          await pushError({
            id: randomUUID(),
            siteId: result.siteId,
            message: result.error ?? "probe failures",
            source: "probe",
            url: result.url,
            receivedAt: result.checkedAt,
            meta: { findings: result.findings?.slice(0, 10) },
          });
        }

        const escalated = await maybeSendEscalation(
          result,
          name,
          downSince,
        );
        if (escalated) alertsSent += 1;
      }
    } else if (result.status === "degraded") {
      // Still partially up — clear hard-down clock but alert on degrade
      await clearDownSince(result.siteId);

      if (!muted) {
        const key = `degraded:${result.siteId}:${hashLite(result.error ?? "deg")}`;
        const fresh = await claimDedupe(key, DEGRADED_DEDUPE_SEC);
        if (fresh) {
          const details = (result.findings ?? [])
            .filter((f) => !f.ok)
            .slice(0, 8)
            .map((f) => `• [${f.kind}] ${f.name}: ${f.message}`)
            .join("\n");
          const ok = await sendTelegramMessage(
            [
              `🟡 ДЕГРАДАЦИЯ: ${name}`,
              `url: ${result.url}`,
              summary,
              details,
              `at: ${result.checkedAt}`,
              "",
              "Подробности: /deep " + result.siteId,
            ].join("\n"),
          );
          if (ok.ok) alertsSent += 1;
        }
      }
    } else if (result.status === "up") {
      const wasDown =
        previous &&
        (previous.status === "down" || previous.status === "degraded");
      const downSince = await getDownSince(result.siteId);
      await clearDownSince(result.siteId);

      if (!muted && wasDown) {
        const downtime = downSince
          ? formatDowntimeHuman(
              Date.now() - new Date(downSince).getTime(),
            )
          : null;
        const ok = await sendTelegramMessage(
          [
            `🟢 СНОВА ОК: ${name}`,
            `url: ${result.url}`,
            summary,
            `http: ${result.httpStatus}`,
            `latency: ${result.latencyMs ?? "?"}ms`,
            downtime ? `простой длился: ${downtime}` : null,
            `at: ${result.checkedAt}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        if (ok.ok) alertsSent += 1;
      }
    }
  }

  return { results, alertsSent };
}

async function maybeSendEscalation(
  result: SiteCheckResult,
  name: string,
  downSinceIso: string,
): Promise<boolean> {
  const sinceMs = new Date(downSinceIso).getTime();
  if (!Number.isFinite(sinceMs)) return false;
  const elapsedMs = Date.now() - sinceMs;
  const elapsedH = elapsedMs / 3_600_000;

  // Fire the highest crossed threshold that hasn't been claimed yet
  // (so if we missed 1h due to downtime of the monitor, 3h still fires).
  let fired = false;
  for (const hours of ESCALATION_HOURS) {
    if (elapsedH < hours) break;
    // Include downSince so a new outage after recovery can escalate again.
    const key = `escalate:${result.siteId}:${hours}h:${downSinceIso}`;
    const fresh = await claimDedupe(key, ESCALATION_DEDUPE_SEC);
    if (!fresh) continue;

    const details = (result.findings ?? [])
      .filter((f) => !f.ok)
      .slice(0, 6)
      .map((f) => `• ${f.name}: ${f.message}`)
      .join("\n");

    const sent = await sendTelegramMessage(
      [
        `🚨 ЭСКАЛАЦИЯ ${hours}ч: ${name} всё ещё лежит`,
        `не работает уже: ${formatDowntimeHuman(elapsedMs)}`,
        `с: ${downSinceIso}`,
        `url: ${result.url}`,
        details || `ошибка: ${result.error ?? "нет ответа"}`,
        `последняя проверка: ${result.checkedAt}`,
        "",
        "Проверь хостинг / оплату / DNS.",
        `Команда: /deep ${result.siteId}`,
      ].join("\n"),
    );
    if (sent.ok) fired = true;
  }
  return fired;
}

export async function ingestReportedError(input: {
  siteId: string;
  message: string;
  stack?: string;
  url?: string;
  source?: ReportedError["source"];
  meta?: Record<string, unknown>;
}): Promise<{ stored: boolean; alerted: boolean; id: string }> {
  const site = await getSiteByIdManaged(input.siteId);
  const error: ReportedError = {
    id: randomUUID(),
    siteId: input.siteId,
    message: input.message.slice(0, 2000),
    stack: input.stack?.slice(0, 4000),
    url: input.url?.slice(0, 500),
    source: input.source ?? "unknown",
    meta: input.meta,
    receivedAt: new Date().toISOString(),
  };

  await pushError(error);

  if (await isMuted(input.siteId)) {
    return { stored: true, alerted: false, id: error.id };
  }

  const fingerprint = hashLite(
    `${input.siteId}|${input.message}|${input.url ?? ""}`,
  );
  const fresh = await claimDedupe(`err:${fingerprint}`, ERROR_DEDUPE_SEC);
  if (!fresh) {
    return { stored: true, alerted: false, id: error.id };
  }

  const name = site?.name ?? input.siteId;
  const lines = [
    `⚠️ ОШИБКА: ${name}`,
    `источник: ${error.source}`,
    `сообщение: ${error.message}`,
  ];
  if (error.url) lines.push(`страница: ${error.url}`);
  if (error.stack) lines.push(`stack:\n${error.stack.slice(0, 1500)}`);
  if (error.meta) {
    lines.push(`meta: ${JSON.stringify(error.meta).slice(0, 500)}`);
  }
  lines.push(`id: ${error.id}`);
  lines.push(`at: ${error.receivedAt}`);

  const sent = await sendTelegramMessage(lines.join("\n"));
  return { stored: true, alerted: sent.ok, id: error.id };
}

function hashLite(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
