import { runHealthSweep } from "@/lib/alerts";
import {
  getBearerOrQuerySecret,
  requireSecret,
} from "@/lib/auth";
import { getSites, getSiteById } from "@/lib/sites";
import { saveCronLastRun } from "@/lib/redis";
import { ensureTelegramWebhook } from "@/lib/telegram";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Deep health + scrape + forms + API + DB probes.
 *
 * Query:
 *   mode=shallow|deep|full   (default deep)
 *   site=<siteId>            optional single site
 *   source=github-actions|vercel-cron|manual
 *
 * Auth: Authorization: Bearer <CRON_SECRET> or ?secret=
 * Vercel Cron auto-sends Bearer CRON_SECRET when that env exists.
 */
export async function GET(request: Request) {
  return handleCheck(request);
}

export async function POST(request: Request) {
  return handleCheck(request);
}

async function handleCheck(request: Request) {
  const secret = getBearerOrQuerySecret(request);
  if (!requireSecret(secret, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const modeParam = url.searchParams.get("mode") ?? "deep";
  const mode =
    modeParam === "shallow" || modeParam === "full" || modeParam === "deep"
      ? modeParam
      : "deep";
  const siteId = url.searchParams.get("site");
  const source =
    url.searchParams.get("source") ||
    request.headers.get("x-vercel-cron-schedule") ||
    (request.headers.get("user-agent")?.includes("GitHubCron")
      ? "github-actions"
      : "manual");

  let sites = getSites();
  if (siteId) {
    const one = getSiteById(siteId);
    if (!one) {
      return NextResponse.json({ error: `Unknown site ${siteId}` }, { status: 404 });
    }
    sites = [one];
  }

  const { results, alertsSent } = await runHealthSweep(sites, { mode });
  const telegram = await ensureTelegramWebhook().catch((err) => ({
    ok: false,
    action: "error" as const,
    message: err instanceof Error ? err.message : String(err),
  }));

  const down = results.filter((r) => r.status === "down").length;
  const degraded = results.filter((r) => r.status === "degraded").length;
  await saveCronLastRun({
    at: new Date().toISOString(),
    mode,
    source: String(source),
    checked: results.length,
    alertsSent,
    down,
    degraded,
  }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    mode,
    source,
    checked: results.length,
    alertsSent,
    down,
    degraded,
    telegram,
    results,
  });
}
