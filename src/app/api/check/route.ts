import { runHealthSweep } from "@/lib/alerts";
import {
  getBearerOrQuerySecret,
  requireSecret,
} from "@/lib/auth";
import { getSites, getSiteById } from "@/lib/sites";
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
 *
 * Auth: Authorization: Bearer <CRON_SECRET> or ?secret=
 */
export async function GET(request: Request) {
  return handleCheck(request);
}

export async function POST(request: Request) {
  return handleCheck(request);
}

async function handleCheck(request: Request) {
  const secret = getBearerOrQuerySecret(request);
  if (!requireSecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const modeParam = url.searchParams.get("mode") ?? "deep";
  const mode =
    modeParam === "shallow" || modeParam === "full" || modeParam === "deep"
      ? modeParam
      : "deep";
  const siteId = url.searchParams.get("site");

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

  return NextResponse.json({
    ok: true,
    mode,
    checked: results.length,
    alertsSent,
    telegram,
    results,
  });
}
