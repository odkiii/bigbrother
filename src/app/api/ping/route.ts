import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public liveness probe — no secrets. If this 404s, Vercel is not routing to this deployment. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "bigbrother",
    now: new Date().toISOString(),
    hasTelegramToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    hasRedis: Boolean(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
    ),
    publicUrl: process.env.BIGBROTHER_PUBLIC_URL ?? null,
    vercelUrl: process.env.VERCEL_URL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  });
}
