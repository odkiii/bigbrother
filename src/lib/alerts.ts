import {
  claimDedupe,
  getSiteStatus,
  isMuted,
  pushError,
  saveSiteStatus,
} from "@/lib/redis";
import { getSiteById } from "@/lib/sites";
import { sendTelegramMessage } from "@/lib/telegram";
import type {
  ReportedError,
  SiteCheckResult,
  SiteConfig,
} from "@/lib/types";
import { checkAllSites } from "@/lib/health";
import { randomUUID } from "crypto";

const DOWN_DEDUPE_SEC = 15 * 60;
const ERROR_DEDUPE_SEC = 5 * 60;

export async function runHealthSweep(sites: SiteConfig[]): Promise<{
  results: SiteCheckResult[];
  alertsSent: number;
}> {
  const results = await checkAllSites(sites);
  let alertsSent = 0;

  for (const result of results) {
    const previous = await getSiteStatus(result.siteId);
    await saveSiteStatus(result);

    const muted = await isMuted(result.siteId);
    if (muted) continue;

    const site = sites.find((s) => s.id === result.siteId);
    const name = site?.name ?? result.siteId;

    if (result.status === "down") {
      const key = `down:${result.siteId}:${result.error ?? result.httpStatus}`;
      const fresh = await claimDedupe(key, DOWN_DEDUPE_SEC);
      const wasUp = !previous || previous.status === "up";
      if (fresh || wasUp) {
        const ok = await sendTelegramMessage(
          [
            `🔴 DOWN: ${name}`,
            `url: ${result.url}`,
            `error: ${result.error ?? "unknown"}`,
            `latency: ${result.latencyMs ?? "?"}ms`,
            `at: ${result.checkedAt}`,
          ].join("\n"),
        );
        if (ok.ok) alertsSent += 1;
      }
    } else if (previous?.status === "down" && result.status === "up") {
      const ok = await sendTelegramMessage(
        [
          `🟢 UP again: ${name}`,
          `url: ${result.url}`,
          `http: ${result.httpStatus}`,
          `latency: ${result.latencyMs ?? "?"}ms`,
          `at: ${result.checkedAt}`,
        ].join("\n"),
      );
      if (ok.ok) alertsSent += 1;
    }
  }

  return { results, alertsSent };
}

export async function ingestReportedError(input: {
  siteId: string;
  message: string;
  stack?: string;
  url?: string;
  source?: ReportedError["source"];
  meta?: Record<string, unknown>;
}): Promise<{ stored: boolean; alerted: boolean; id: string }> {
  const site = getSiteById(input.siteId);
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
    `⚠️ ERROR: ${name}`,
    `source: ${error.source}`,
    `message: ${error.message}`,
  ];
  if (error.url) lines.push(`page: ${error.url}`);
  if (error.stack) lines.push(`stack:\n${error.stack.slice(0, 1500)}`);
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
