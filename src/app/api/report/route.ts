import { ingestReportedError } from "@/lib/alerts";
import {
  getBearerOrQuerySecret,
  requireSecret,
} from "@/lib/auth";
import { getSiteById } from "@/lib/sites";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({
  siteId: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  source: z.enum(["client", "server", "probe", "unknown"]).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Sites POST runtime/server errors here.
 * Header: Authorization: Bearer <REPORT_SECRET> or x-bigbrother-secret
 */
export async function POST(request: Request) {
  const secret = getBearerOrQuerySecret(request);
  if (!requireSecret(secret, process.env.REPORT_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (!getSiteById(parsed.data.siteId)) {
    return NextResponse.json(
      {
        error: `Unknown siteId "${parsed.data.siteId}". Add it to DEFAULT_SITES or SITES_JSON.`,
      },
      { status: 400 },
    );
  }

  const result = await ingestReportedError(parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
