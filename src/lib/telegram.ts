const TELEGRAM_API = "https://api.telegram.org";

export function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  return { token, chatId };
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

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: target,
      text: truncate(text, 4000),
      disable_web_page_preview: true,
    }),
  });

  const data = (await res.json()) as { ok: boolean; description?: string };
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
  await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}\n…(truncated)`;
}

export type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { chat: { id: number } };
  };
};
