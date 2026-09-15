import { runHealthSweep } from "@/lib/alerts";
import { isAllowedTelegramUser } from "@/lib/auth";
import {
  getAllSiteStatuses,
  listErrors,
  muteSite,
  unmuteSite,
} from "@/lib/redis";
import { getProbeConfig } from "@/lib/probes/load";
import { describeProbeConfig } from "@/lib/probes/runner";
import { getSites } from "@/lib/sites";
import {
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram";

export async function handleTelegramUpdate(
  update: TelegramUpdate,
): Promise<{ handled: boolean }> {
  const message = update.message ?? update.edited_message;
  if (!message?.text || !message.chat) {
    return { handled: false };
  }

  const userId = message.from?.id;
  if (!isAllowedTelegramUser(userId)) {
    await sendTelegramMessage("Access denied.", String(message.chat.id));
    return { handled: true };
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
      case "/probes": {
        const siteId = args[0];
        await sendTelegramMessage(formatProbes(siteId), chatId);
        break;
      }
      case "/errors": {
        const n = Math.min(Number(args[0]) || 10, 30);
        await sendTelegramMessage(await formatErrors(n), chatId);
        break;
      }
      case "/check":
      case "/deep":
      case "/full": {
        const mode =
          command === "/full"
            ? "full"
            : command === "/check"
              ? "shallow"
              : "deep";
        const siteFilter = args[0];
        let sites = getSites();
        if (siteFilter) {
          sites = sites.filter((s) => s.id === siteFilter);
          if (sites.length === 0) {
            await sendTelegramMessage(`Unknown siteId: ${siteFilter}`, chatId);
            break;
          }
        }
        await sendTelegramMessage(
          `Running ${mode} probes${siteFilter ? ` for ${siteFilter}` : ""}…`,
          chatId,
        );
        const { results, alertsSent } = await runHealthSweep(sites, { mode });
        const lines = results.map((r) => {
          const icon =
            r.status === "up" ? "🟢" : r.status === "degraded" ? "🟡" : "🔴";
          const sum = r.probeSummary
            ? `p${r.probeSummary.total}/f${r.probeSummary.failed}/w${r.probeSummary.warnings}`
            : "";
          const err = r.error ? `\n  ${r.error.slice(0, 180)}` : "";
          return `${icon} ${r.siteId}: ${r.status} ${sum} ${r.latencyMs ?? "?"}ms${err}`;
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

  return { handled: true };
}

function helpText(): string {
  return [
    "Big Brother — total control",
    "",
    "/status — last statuses",
    "/check [siteId] — fast HTTP ping",
    "/deep [siteId] — scrape + forms + API + DB",
    "/full [siteId] — deep + crawl corners of site",
    "/probes [siteId] — what is configured",
    "/errors [n] — recent errors",
    "/sites — list",
    "/mute <siteId> [min]",
    "/unmute <siteId>",
    "/chatid",
    "/help",
  ].join("\n");
}

function formatSites(): string {
  return getSites()
    .map((s) => `• ${s.id} — ${s.name}\n  ${s.url} (${s.host})`)
    .join("\n\n");
}

function formatProbes(siteId?: string): string {
  const sites = siteId
    ? getSites().filter((s) => s.id === siteId)
    : getSites();
  if (sites.length === 0) return `Unknown site: ${siteId}`;
  return sites
    .map((s) => {
      const cfg = getProbeConfig(s.id);
      return `• ${s.id}\n  ${describeProbeConfig(cfg)}`;
    })
    .join("\n\n");
}

async function formatStatus(): Promise<string> {
  const sites = getSites();
  const statuses = await getAllSiteStatuses(sites.map((s) => s.id));
  const lines = sites.map((s) => {
    const st = statuses[s.id];
    if (!st) return `⚪ ${s.name}: unknown (no check yet)`;
    const icon =
      st.status === "up" ? "🟢" : st.status === "degraded" ? "🟡" : "🔴";
    const sum = st.probeSummary
      ? ` · fail ${st.probeSummary.failed}/warn ${st.probeSummary.warnings}`
      : "";
    return `${icon} ${s.name}: ${st.status}${sum} · ${st.latencyMs ?? "?"}ms · ${st.checkedAt}`;
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
