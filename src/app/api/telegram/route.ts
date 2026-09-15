import { getBearerOrQuerySecret, requireSecret, secretsEqual } from "@/lib/auth";
import { handleTelegramUpdate } from "@/lib/telegram-commands";
import {
  ensureTelegramWebhook,
  getTelegramConfig,
  getWebhookInfo,
  probePublicTelegramRoute,
  telegramWebhookDisplayUrl,
  type TelegramUpdate,
} from "@/lib/telegram";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function isTelegramWebhookAuthorized(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true;
  const url = new URL(request.url);
  const query = url.searchParams.get("secret");
  const header = request.headers.get("x-telegram-bot-api-secret-token");
  return secretsEqual(query, expected) || secretsEqual(header, expected);
}

function isOpsAuthorized(request: Request): boolean {
  const provided = getBearerOrQuerySecret(request);
  return (
    requireSecret(provided, process.env.CRON_SECRET) ||
    requireSecret(provided, process.env.TELEGRAM_WEBHOOK_SECRET)
  );
}

/**
 * Telegram bot webhook.
 * Telegram native secret: header x-telegram-bot-api-secret-token
 * Optional query: ?secret=TELEGRAM_WEBHOOK_SECRET
 *
 * GET with CRON_SECRET or TELEGRAM_WEBHOOK_SECRET → diagnostics + auto-register.
 */
export async function GET(request: Request) {
  if (!isOpsAuthorized(request)) {
    return NextResponse.json(
      { ok: true, service: "telegram-webhook", auth: "POST from Telegram" },
      { status: 200 },
    );
  }

  const { token, chatId } = getTelegramConfig();
  const probe = await probePublicTelegramRoute();
  const webhook = token ? await getWebhookInfo() : null;
  const ensured = token ? await ensureTelegramWebhook() : null;
  const currentUrl = webhook?.result?.url ?? "";

  return NextResponse.json({
    ok: Boolean(token) && probe.reachable && ensured?.ok !== false,
    hasToken: Boolean(token),
    hasChatId: Boolean(chatId),
    publicUrl: telegramWebhookDisplayUrl(),
    webhookHost: hostOnly(currentUrl),
    lastError: webhook?.result?.last_error_message ?? null,
    pendingUpdates: webhook?.result?.pending_update_count ?? null,
    probe,
    ensure: ensured,
    hint: hintFrom(probe, Boolean(token)),
  });
}

export async function POST(request: Request) {
  if (!isTelegramWebhookAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  await handleTelegramUpdate(update);
  return NextResponse.json({ ok: true });
}

function hostOnly(url: string): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

function hintFrom(
  probe: Awaited<ReturnType<typeof probePublicTelegramRoute>>,
  hasToken: boolean,
): string {
  if (!hasToken) return "Set TELEGRAM_BOT_TOKEN in Vercel env, then GET this URL with ?secret=CRON_SECRET";
  if (probe.deploymentMissing)
    return "Production alias is dead (DEPLOYMENT_NOT_FOUND). Set BIGBROTHER_PUBLIC_URL to a live domain and assign it in Vercel.";
  if (probe.protection)
    return "Vercel Deployment Protection is blocking Telegram. Disable SSO on Production, or enable Protection Bypass for Automation (VERCEL_AUTOMATION_BYPASS_SECRET).";
  if (!probe.reachable)
    return "Webhook URL is not reachable. Set BIGBROTHER_PUBLIC_URL and re-register via GET /api/telegram?secret=CRON_SECRET";
  return "Webhook path looks reachable. Send /start to the bot.";
}
