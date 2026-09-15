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
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) return true;
  const url = new URL(request.url);
  const query = url.searchParams.get("secret");
  const header = request.headers.get("x-telegram-bot-api-secret-token");
  return secretsEqual(query, expected) || secretsEqual(header, expected);
}

function isOpsAuthorized(request: Request): boolean {
  const provided = getBearerOrQuerySecret(request);
  return (
    requireSecret(provided, process.env.CRON_SECRET?.trim()) ||
    requireSecret(provided, process.env.TELEGRAM_WEBHOOK_SECRET?.trim())
  );
}

/**
 * Telegram bot webhook.
 *
 * GET without secret → 401 + how to register (not a fake ok).
 * GET ?secret=CRON_SECRET → diagnostics + setWebhook
 * GET ?secret=CRON_SECRET&force=1 → always re-register webhook
 * POST → Telegram updates (secret_token header or ?secret=)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const provided = getBearerOrQuerySecret(request);

  if (!isOpsAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
        hint:
          "Добавь ?secret=ЗНАЧЕНИЕ_CRON_SECRET из Vercel → Settings → Environment Variables (Production). Без секрета webhook НЕ регистрируется. Пример: /api/telegram?secret=abc123&force=1",
        hasCronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        hasWebhookSecretConfigured: Boolean(
          process.env.TELEGRAM_WEBHOOK_SECRET?.trim(),
        ),
        receivedSecretLength: provided?.length ?? 0,
      },
      { status: 401 },
    );
  }

  const force = url.searchParams.get("force") === "1";
  const { token, chatId } = getTelegramConfig();
  const probe = await probePublicTelegramRoute();
  const webhookBefore = token ? await getWebhookInfo() : null;
  const ensured = token ? await ensureTelegramWebhook({ force }) : null;
  const webhookAfter = token ? await getWebhookInfo() : null;
  const currentUrl = webhookAfter?.result?.url ?? "";

  return NextResponse.json({
    ok: Boolean(token) && ensured?.ok !== false,
    hasToken: Boolean(token),
    hasChatId: Boolean(chatId),
    force,
    publicUrl: telegramWebhookDisplayUrl(),
    webhookUrlHost: hostOnly(currentUrl),
    webhookUrlSet: Boolean(currentUrl),
    lastError: webhookAfter?.result?.last_error_message ?? null,
    pendingUpdates: webhookAfter?.result?.pending_update_count ?? null,
    webhookBefore: webhookBefore?.result?.url
      ? hostOnly(webhookBefore.result.url)
      : null,
    probe,
    ensure: ensured,
    nextStep:
      ensured?.ok && currentUrl
        ? "Напиши боту: /start — меню с кнопками, /help — описание. Эскалации 1/3/6/12ч идут в TELEGRAM_CHAT_ID."
        : "Смотри ensure.message / lastError. Проверь TELEGRAM_BOT_TOKEN и BIGBROTHER_PUBLIC_URL.",
    hint: hintFrom(probe, Boolean(token), ensured?.ok === true),
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
  ensuredOk: boolean,
): string {
  if (!hasToken) return "Set TELEGRAM_BOT_TOKEN in Vercel Production env";
  if (probe.deploymentMissing)
    return "BIGBROTHER_PUBLIC_URL points to a dead host";
  if (probe.protection)
    return "Turn off Vercel Deployment Protection (Require Log In) for Production";
  if (!ensuredOk) return "setWebhook failed — see ensure.message";
  return "Webhook OK. Message the bot: /start";
}
