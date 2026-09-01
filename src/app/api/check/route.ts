import { runHealthSweep } from "@/lib/alerts";
import {
  getBearerOrQuerySecret,
  requireSecret,
} from "@/lib/auth";
import { getSites } from "@/lib/sites";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Health sweep for all monitored sites.
 * Call every ~5 minutes from an external free cron (cron-job.org), because
 * Vercel Hobby only allows once-per-day native crons.
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
  // Vercel Cron also sends Authorization: Bearer <CRON_SECRET> when env is set.
  if (!requireSecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sites = getSites();
  const { results, alertsSent } = await runHealthSweep(sites);

  return NextResponse.json({
    ok: true,
    checked: results.length,
    alertsSent,
    results,
  });
}
