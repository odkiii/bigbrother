import { runHealthSweep } from "@/lib/alerts";
import { isAllowedTelegramUser } from "@/lib/auth";
import {
  getAllSiteStatuses,
  listErrors,
  muteSite,
  unmuteSite,
} from "@/lib/redis";
import { getSites } from "@/lib/sites";
import {
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Telegram bot webhook. Set webhook to:
 * https://<your-domain>/api/telegram?secret=<TELEGRAM_WEBHOOK_SECRET>
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = update.message;
  if (!message?.text || !message.chat) {
    return NextResponse.json({ ok: true });
  }

  const userId = message.from?.id;
  if (!isAllowedTelegramUser(userId)) {
    await sendTelegramMessage("Access denied.", String(message.chat.id));
    return NextResponse.json({ ok: true });
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const [cmd, ...args] = text.split(/\s+/);
  const command = (cmd || "").split("@")[0].toLowerCase();

  try {
    switch (command) {
      case "/start":
      case "/help":
        await sendTelegramMessage(helpText(), chatId);
        break;
      case "/status":
        await sendTelegramMessage(await formatStatus(), chatId);
        break;
      case "/sites":
        await sendTelegramMessage(formatSites(), chatId);
        break;
      case "/errors": {
        const n = Math.min(Number(args[0]) || 10, 30);
        await sendTelegramMessage(await formatErrors(n), chatId);
        break;
      }
      case "/check": {
        await sendTelegramMessage("Running health check…", chatId);
        const { results, alertsSent } = await runHealthSweep(getSites());
        const lines = results.map((r) => {
          const icon = r.status === "up" ? "🟢" : "🔴";
          return `${icon} ${r.siteId}: ${r.status} ${r.httpStatus ?? ""} ${r.error ?? ""} ${r.latencyMs ?? "?"}ms`.trim();
        });
        lines.push(`alertsSent: ${alertsSent}`);
        await sendTelegramMessage(lines.join("\n"), chatId);
        break;
      }
      case "/mute": {
        const siteId = args[0];
        const minutes = Number(args[1]) || 60;
        if (!siteId) {
          await sendTelegramMessage("Usage: /mute <siteId> [minutes]", chatId);
          break;
        }
        await muteSite(siteId, minutes);
        await sendTelegramMessage(
          `Muted ${siteId} for ${minutes} minutes.`,
          chatId,
        );
        break;
      }
      case "/unmute": {
        const siteId = args[0];
        if (!siteId) {
          await sendTelegramMessage("Usage: /unmute <siteId>", chatId);
          break;
        }
        await unmuteSite(siteId);
        await sendTelegramMessage(`Unmuted ${siteId}.`, chatId);
        break;
      }
      case "/chatid":
        await sendTelegramMessage(
          `Your chat id: ${chatId}\nYour user id: ${userId ?? "?"}`,
          chatId,
        );
        break;
      default:
        await sendTelegramMessage(
          `Unknown command. Try /help\n\nGot: ${text}`,
          chatId,
        );
    }
  } catch (err) {
    console.error("[telegram]", err);
    await sendTelegramMessage(
      `Bot error: ${err instanceof Error ? err.message : String(err)}`,
      chatId,
    );
  }

  return NextResponse.json({ ok: true });
}

function helpText(): string {
  return [
    "Big Brother — monitoring bot",
    "",
    "/status — last known statuses",
    "/check — run health checks now",
    "/errors [n] — recent runtime errors",
    "/sites — monitored sites",
    "/mute <siteId> [min] — mute alerts",
    "/unmute <siteId>",
    "/chatid — show chat/user ids for .env",
    "/help",
  ].join("\n");
}

function formatSites(): string {
  return getSites()
    .map((s) => `• ${s.id} — ${s.name}\n  ${s.url} (${s.host})`)
    .join("\n\n");
}

async function formatStatus(): Promise<string> {
  const sites = getSites();
  const statuses = await getAllSiteStatuses(sites.map((s) => s.id));
  const lines = sites.map((s) => {
    const st = statuses[s.id];
    if (!st) return `⚪ ${s.name}: unknown (no check yet)`;
    const icon = st.status === "up" ? "🟢" : "🔴";
    return `${icon} ${s.name}: ${st.status} · HTTP ${st.httpStatus ?? "—"} · ${st.latencyMs ?? "?"}ms · ${st.checkedAt}`;
  });
  return lines.join("\n");
}

async function formatErrors(n: number): Promise<string> {
  const errors = await listErrors(n);
  if (errors.length === 0) return "No stored errors yet.";
  return errors
    .map(
      (e) =>
        `• [${e.siteId}] ${e.source} @ ${e.receivedAt}\n  ${e.message.slice(0, 200)}`,
    )
    .join("\n\n");
}
