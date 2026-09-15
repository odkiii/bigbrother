import { getBearerOrQuerySecret, requireSecret } from "@/lib/auth";
import { getTelegramOffset, setTelegramOffset } from "@/lib/redis";
import { handleTelegramUpdate } from "@/lib/telegram-commands";
import { getTelegramUpdates } from "@/lib/telegram";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fallback when webhook cannot be delivered (Vercel SSO, dead alias).
 * Poll Telegram getUpdates. Auth: CRON_SECRET.
 *
 * If a webhook is already set, Telegram returns 409 — use /api/telegram setup instead.
 */
async function poll(request: Request) {
  const secret = getBearerOrQuerySecret(request);
  if (!requireSecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const offset = await getTelegramOffset();
  const data = await getTelegramUpdates(offset);
  if (!data.ok) {
    return NextResponse.json(
      { ok: false, error: data.description ?? "getUpdates failed" },
      { status: 502 },
    );
  }

  const updates = data.result ?? [];
  let handled = 0;
  let maxId = offset;
  for (const u of updates) {
    if (u.update_id >= maxId) maxId = u.update_id + 1;
    const r = await handleTelegramUpdate(u);
    if (r.handled) handled += 1;
  }
  if (maxId !== offset) await setTelegramOffset(maxId);

  return NextResponse.json({
    ok: true,
    received: updates.length,
    handled,
    nextOffset: maxId,
  });
}

export async function GET(request: Request) {
  return poll(request);
}

export async function POST(request: Request) {
  return poll(request);
}
