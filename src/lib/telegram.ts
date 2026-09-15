const TELEGRAM_API = "https://api.telegram.org";

export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; username?: string };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { chat: { id: number } };
  };
};

export function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return { token, chatId };
}

function telegramSecretToken(): string | undefined {
  const raw = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!raw) return undefined;
  // Telegram secret_token: 1-256 chars, A-Z a-z 0-9 _ -
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(raw)) return undefined;
  return raw;
}

/** Public origin of this app (no trailing slash). */
export function publicBaseUrl(): string {
  const explicit = process.env.BIGBROTHER_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return prod.startsWith("http") ? prod.replace(/\/$/, "") : `https://${prod}`;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "";
}

/**
 * URL Telegram should POST to. Includes Vercel protection bypass query
 * when VERCEL_AUTOMATION_BYPASS_SECRET is set (webhooks cannot send headers).
 */
export function telegramWebhookDeliveryUrl(): string {
  const base = publicBaseUrl();
  if (!base) return "";
  const params = new URLSearchParams();
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) params.set("x-vercel-protection-bypass", bypass);
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  // Query fallback when secret_token cannot be used, or for old clients.
  if (secret && !telegramSecretToken()) params.set("secret", secret);
  const qs = params.toString();
  return `${base}/api/telegram${qs ? `?${qs}` : ""}`;
}

export function telegramWebhookDisplayUrl(): string {
  const base = publicBaseUrl();
  return base ? `${base}/api/telegram` : "";
}

async function telegramApi<T>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T & { ok: boolean; description?: string }> {
  const { token } = getTelegramConfig();
  if (!token) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN not set" } as T & {
      ok: boolean;
      description?: string;
    };
  }
  const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  try {
    return (await res.json()) as T & { ok: boolean; description?: string };
  } catch {
    return {
      ok: false,
      description: `Telegram HTTP ${res.status}`,
    } as T & { ok: boolean; description?: string };
  }
}

export async function sendTelegramMessage(
  text: string,
  chatIdOverride?: string,
): Promise<{ ok: boolean; description?: string }> {
  const { token, chatId } = getTelegramConfig();
  const target = chatIdOverride || chatId;
  if (!token || !target) {
    console.warn("[bigbrother] Telegram not configured");
    return { ok: false, description: "Telegram not configured" };
  }

  const data = await telegramApi<{ ok: boolean; description?: string }>(
    "sendMessage",
    {
      chat_id: target,
      text: truncate(text, 4000),
      disable_web_page_preview: true,
    },
  );
  if (!data.ok) {
    console.error("[bigbrother] Telegram send failed", data);
  }
  return data;
}

export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  const { token } = getTelegramConfig();
  if (!token) return;
  await telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function getWebhookInfo(): Promise<{
  ok: boolean;
  description?: string;
  result?: {
    url?: string;
    last_error_message?: string;
    last_error_date?: number;
    pending_update_count?: number;
    has_custom_certificate?: boolean;
  };
}> {
  return telegramApi("getWebhookInfo");
}

export async function setTelegramWebhook(): Promise<{
  ok: boolean;
  description?: string;
  url?: string;
  deliveryUrlHost?: string;
  usedSecretToken?: boolean;
}> {
  const url = telegramWebhookDeliveryUrl();
  if (!url) {
    return {
      ok: false,
      description:
        "No public URL. Set BIGBROTHER_PUBLIC_URL to the live Vercel domain (no trailing slash).",
    };
  }
  const secret_token = telegramSecretToken();
  const body: Record<string, unknown> = {
    url,
    drop_pending_updates: true,
    allowed_updates: ["message", "edited_message"],
  };
  if (secret_token) body.secret_token = secret_token;

  const data = await telegramApi<{ ok: boolean; description?: string }>(
    "setWebhook",
    body,
  );
  return {
    ...data,
    url: telegramWebhookDisplayUrl(),
    deliveryUrlHost: hostOf(url),
    usedSecretToken: Boolean(secret_token),
  };
}

export type TelegramUpdateItem = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export async function getTelegramUpdates(offset: number): Promise<{
  ok: boolean;
  description?: string;
  result?: TelegramUpdateItem[];
}> {
  return telegramApi("getUpdates", {
    offset,
    timeout: 0,
    allowed_updates: ["message", "edited_message"],
  });
}

export type WebhookEnsureResult = {
  ok: boolean;
  action: "skipped" | "already" | "set" | "error";
  message: string;
  lastError?: string;
  pending?: number;
};

/**
 * Register webhook if missing or pointing at the wrong host.
 * Pass force=true to always call setWebhook (fixes stale secret_token).
 */
export async function ensureTelegramWebhook(options?: {
  force?: boolean;
}): Promise<WebhookEnsureResult> {
  const force = options?.force === true;
  const { token } = getTelegramConfig();
  if (!token) {
    return {
      ok: false,
      action: "skipped",
      message: "TELEGRAM_BOT_TOKEN not set",
    };
  }
  const desired = telegramWebhookDeliveryUrl();
  const display = telegramWebhookDisplayUrl();
  if (!desired) {
    return {
      ok: false,
      action: "error",
      message:
        "BIGBROTHER_PUBLIC_URL (or Vercel URL) missing — cannot register webhook",
    };
  }

  const info = await getWebhookInfo();
  if (!info.ok) {
    return {
      ok: false,
      action: "error",
      message: info.description ?? "getWebhookInfo failed",
    };
  }

  const current = info.result?.url ?? "";
  const desiredHost = hostOf(desired);
  const currentHost = hostOf(current);
  const sameHost = Boolean(desiredHost && currentHost && desiredHost === currentHost);
  const lastError = info.result?.last_error_message;
  const pending = info.result?.pending_update_count;

  if (sameHost && !lastError && !force) {
    return {
      ok: true,
      action: "already",
      message: `Webhook already on ${display}`,
      pending,
    };
  }

  const set = await setTelegramWebhook();
  if (!set.ok) {
    return {
      ok: false,
      action: "error",
      message: set.description ?? "setWebhook failed",
      lastError,
      pending,
    };
  }
  return {
    ok: true,
    action: "set",
    message: `Webhook registered: ${display}`,
    lastError,
    pending,
  };
}

export async function probePublicTelegramRoute(): Promise<{
  reachable: boolean;
  status: number;
  protection: boolean;
  deploymentMissing: boolean;
  snippet: string;
}> {
  const url = telegramWebhookDisplayUrl();
  if (!url) {
    return {
      reachable: false,
      status: 0,
      protection: false,
      deploymentMissing: false,
      snippet: "no public URL",
    };
  }
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", redirect: "manual" });
    const text = await res.text().catch(() => "");
    const snippet = text.slice(0, 180);
    const protection =
      res.status === 401 && /vercel_auth|Protected deployment/i.test(text);
    const deploymentMissing =
      res.status === 404 && /DEPLOYMENT_NOT_FOUND/i.test(text);
    return {
      reachable: res.status > 0 && res.status < 500 && !protection && !deploymentMissing,
      status: res.status,
      protection,
      deploymentMissing,
      snippet,
    };
  } catch (err) {
    return {
      reachable: false,
      status: 0,
      protection: false,
      deploymentMissing: false,
      snippet: err instanceof Error ? err.message : String(err),
    };
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}\n…(truncated)`;
}
