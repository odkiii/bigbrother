import { listErrors, getAllSiteStatuses } from "@/lib/redis";
import { getManagedSites } from "@/lib/site-registry";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const sites = await getManagedSites();
  const statuses = await getAllSiteStatuses(sites.map((s) => s.id));
  const errors = await listErrors(30);

  return NextResponse.json({
    ok: true,
    sites: sites.map((s) => ({
      ...s,
      lastCheck: statuses[s.id] ?? null,
    })),
    recentErrors: errors,
  });
}
