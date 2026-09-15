import { runHealthSweep } from "@/lib/alerts";
import { isAllowedTelegramUser } from "@/lib/auth";
import {
  getAllSiteStatuses,
  getTelegramChatState,
  isTelegramWebhookCallbacksOk,
  listErrors,
  muteSite,
  setTelegramChatState,
  unmuteSite,
} from "@/lib/redis";
import { getProbeConfig } from "@/lib/probes/load";
import { describeProbeConfig } from "@/lib/probes/runner";
import {
  addSiteFromTelegram,
  findManagedSite,
  getManagedSites,
  removeSiteFromTelegram,
} from "@/lib/site-registry";
import {
  formatDetailedCheckReport,
  formatErrorDetailed,
  formatStatusLine,
  HELP_TEXT,
} from "@/lib/telegram-format";
import {
  answerTelegramCallback,
  ensureTelegramWebhook,
  sendTelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram";
import {
  afterCheckKeyboard,
  cancelKeyboard,
  confirmRemoveKeyboard,
  mainMenuKeyboard,
  siteActionsKeyboard,
  sitesListKeyboard,
} from "@/lib/telegram-ui";
import type { SiteConfig } from "@/lib/types";

/** Upgrade stale webhook (no callback_query) without slowing every request. */
async function healWebhookForButtons(): Promise<void> {
  try {
    if (await isTelegramWebhookCallbacksOk()) return;
    await ensureTelegramWebhook();
  } catch (err) {
    console.warn("[telegram] webhook heal failed", err);
  }
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
): Promise<{ handled: boolean }> {
  if (update.callback_query) {
    return handleCallback(update);
  }

  const message = update.message ?? update.edited_message;
  if (!message?.text || !message.chat) {
    return { handled: false };
  }

  // Commands work even with stale webhook — use that to enable buttons.
  await healWebhookForButtons();

  const userId = message.from?.id;
  if (!isAllowedTelegramUser(userId)) {
    await sendTelegramMessage("Доступ запрещён.", String(message.chat.id));
    return { handled: true };
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();

  // Conversation flow (add site)
  const state = await getTelegramChatState(chatId);
  if (state && !text.startsWith("/")) {
    await handleConversation(chatId, text, state);
    return { handled: true };
  }

  const [cmd, ...args] = text.split(/\s+/);
  const command = (cmd || "").split("@")[0].toLowerCase();

  try {
    switch (command) {
      case "/start":
        await sendTelegramMessage(
          "👁 Big Brother онлайн.\nКнопки ниже. Если не реагируют — напиши /start ещё раз через минуту (webhook обновляется).",
          chatId,
          { reply_markup: mainMenuKeyboard() },
        );
        break;
      case "/help":
        await sendTelegramMessage(HELP_TEXT, chatId, {
          reply_markup: mainMenuKeyboard(),
        });
        break;
      case "/status":
        await sendTelegramMessage(await formatStatus(), chatId, {
          reply_markup: mainMenuKeyboard(),
        });
        break;
      case "/sites": {
        const sites = await getManagedSites();
        await sendTelegramMessage(formatSitesList(sites), chatId, {
          reply_markup: sitesListKeyboard(sites),
        });
        break;
      }
      case "/probes": {
        await sendTelegramMessage(await formatProbes(args[0]), chatId);
        break;
      }
      case "/errors": {
        const n = Math.min(Number(args[0]) || 10, 30);
        await sendTelegramMessage(await formatErrors(n), chatId, {
          reply_markup: mainMenuKeyboard(),
        });
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
        await runCheckCommand(chatId, mode, args[0]);
        break;
      }
      case "/add": {
        if (args[0]) {
          const result = await addSiteFromTelegram({
            url: args[0],
            name: args.slice(1).join(" ") || undefined,
          });
          if (!result.ok) {
            await sendTelegramMessage(result.error, chatId);
            break;
          }
          await sendTelegramMessage(
            `✅ Добавлен: ${result.site.name}\nid: ${result.site.id}\n${result.site.url}`,
            chatId,
            { reply_markup: siteActionsKeyboard(result.site.id) },
          );
        } else {
          await setTelegramChatState(chatId, { step: "add_url" });
          await sendTelegramMessage(
            "Пришли URL сайта (например https://example.com).\nМожно сразу: /add https://example.com Название",
            chatId,
            { reply_markup: cancelKeyboard() },
          );
        }
        break;
      }
      case "/remove": {
        if (!args[0]) {
          const sites = await getManagedSites();
          await sendTelegramMessage(
            "Выбери сайт для удаления или: /remove <id>",
            chatId,
            { reply_markup: sitesListKeyboard(sites) },
          );
          break;
        }
        const site = await findManagedSite(args[0]);
        if (!site) {
          await sendTelegramMessage(`Сайт «${args[0]}» не найден`, chatId);
          break;
        }
        await sendTelegramMessage(
          `Удалить «${site.name}» (${site.id}) из мониторинга?`,
          chatId,
          { reply_markup: confirmRemoveKeyboard(site.id) },
        );
        break;
      }
      case "/mute": {
        const siteId = args[0];
        const minutes = Number(args[1]) || 60;
        if (!siteId) {
          await sendTelegramMessage("Использование: /mute <siteId> [минуты]", chatId);
          break;
        }
        await muteSite(siteId, minutes);
        await sendTelegramMessage(
          `Алерты для ${siteId} выключены на ${minutes} мин.`,
          chatId,
        );
        break;
      }
      case "/unmute": {
        const siteId = args[0];
        if (!siteId) {
          await sendTelegramMessage("Использование: /unmute <siteId>", chatId);
          break;
        }
        await unmuteSite(siteId);
        await sendTelegramMessage(`Алерты для ${siteId} снова включены.`, chatId);
        break;
      }
      case "/chatid":
        await sendTelegramMessage(
          `chat id: ${chatId}\nuser id: ${userId ?? "?"}\n\nПоложи chat id в TELEGRAM_CHAT_ID на Vercel — туда пойдут алерты о падениях и эскалации 1/3/6/12ч.`,
          chatId,
        );
        break;
      case "/cancel":
        await setTelegramChatState(chatId, null);
        await sendTelegramMessage("Отменено.", chatId, {
          reply_markup: mainMenuKeyboard(),
        });
        break;
      default:
        await sendTelegramMessage(
          `Неизвестная команда. Смотри /help\n\nПолучено: ${text}`,
          chatId,
          { reply_markup: mainMenuKeyboard() },
        );
    }
  } catch (err) {
    console.error("[telegram]", err);
    await sendTelegramMessage(
      `Ошибка бота: ${err instanceof Error ? err.message : String(err)}`,
      chatId,
    );
  }

  return { handled: true };
}

async function handleCallback(
  update: TelegramUpdate,
): Promise<{ handled: boolean }> {
  const cq = update.callback_query!;
  const userId = cq.from?.id;
  const chatId = cq.message?.chat?.id != null ? String(cq.message.chat.id) : null;

  if (!isAllowedTelegramUser(userId)) {
    await answerTelegramCallback(cq.id, "Доступ запрещён");
    return { handled: true };
  }
  if (!chatId) {
    await answerTelegramCallback(cq.id, "Нет чата");
    return { handled: true };
  }

  const data = (cq.data ?? "").trim();
  // Stop Telegram loading spinner immediately (no toast).
  await answerTelegramCallback(cq.id);

  try {
    if (data === "m") {
      await sendTelegramMessage("Меню:", chatId, {
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data === "st") {
      await sendTelegramMessage(await formatStatus(), chatId, {
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data === "ls") {
      const sites = await getManagedSites();
      await sendTelegramMessage(formatSitesList(sites), chatId, {
        reply_markup: sitesListKeyboard(sites),
      });
    } else if (data === "er") {
      await sendTelegramMessage(await formatErrors(10), chatId, {
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data === "hp") {
      await sendTelegramMessage(HELP_TEXT, chatId, {
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data === "ad") {
      await setTelegramChatState(chatId, { step: "add_url" });
      await sendTelegramMessage(
        "Пришли URL сайта (например https://example.com)",
        chatId,
        { reply_markup: cancelKeyboard() },
      );
    } else if (data === "ca") {
      await runCheckCommand(chatId, "shallow");
    } else if (data === "da") {
      await runCheckCommand(chatId, "deep");
    } else if (data === "x") {
      await setTelegramChatState(chatId, null);
      await sendTelegramMessage("Отменено.", chatId, {
        reply_markup: mainMenuKeyboard(),
      });
    } else if (data.startsWith("s:")) {
      const id = data.slice(2);
      const site = await findManagedSite(id);
      if (!site) {
        await sendTelegramMessage(`Сайт ${id} не найден`, chatId);
      } else {
        await sendTelegramMessage(
          `Сайт: ${site.name}\nid: ${site.id}\n${site.url}\nhost: ${site.host}\n\nВыбери проверку:`,
          chatId,
          { reply_markup: siteActionsKeyboard(site.id) },
        );
      }
    } else if (data.startsWith("c:")) {
      await runCheckCommand(chatId, "shallow", data.slice(2));
    } else if (data.startsWith("d:")) {
      await runCheckCommand(chatId, "deep", data.slice(2));
    } else if (data.startsWith("f:")) {
      await runCheckCommand(chatId, "full", data.slice(2));
    } else if (data.startsWith("rm:")) {
      const id = data.slice(3);
      const site = await findManagedSite(id);
      if (!site) {
        await sendTelegramMessage(`Сайт ${id} не найден`, chatId);
      } else {
        await sendTelegramMessage(
          `Удалить «${site.name}» из мониторинга?\n${site.url}`,
          chatId,
          { reply_markup: confirmRemoveKeyboard(site.id) },
        );
      }
    } else if (data.startsWith("rc:")) {
      const id = data.slice(3);
      const result = await removeSiteFromTelegram(id);
      if (!result.ok) {
        await sendTelegramMessage(result.error, chatId);
      } else {
        await sendTelegramMessage(
          `🗑 Удалён: ${result.site.name} (${result.site.id})`,
          chatId,
          { reply_markup: mainMenuKeyboard() },
        );
      }
    } else {
      await sendTelegramMessage(`Неизвестная кнопка: ${data}`, chatId);
    }
  } catch (err) {
    console.error("[telegram callback]", err);
    await sendTelegramMessage(
      `Ошибка: ${err instanceof Error ? err.message : String(err)}`,
      chatId,
    );
  }

  return { handled: true };
}

async function handleConversation(
  chatId: string,
  text: string,
  state: NonNullable<Awaited<ReturnType<typeof getTelegramChatState>>>,
): Promise<void> {
  if (state.step === "add_url") {
    const url = text.trim();
    await setTelegramChatState(chatId, { step: "add_name", url });
    await sendTelegramMessage(
      `URL принят.\nПришли короткое название сайта (или «-» чтобы взять из домена).`,
      chatId,
      { reply_markup: cancelKeyboard() },
    );
    return;
  }

  if (state.step === "add_name") {
    const name = text.trim() === "-" ? undefined : text.trim();
    const result = await addSiteFromTelegram({ url: state.url, name });
    await setTelegramChatState(chatId, null);
    if (!result.ok) {
      await sendTelegramMessage(result.error, chatId, {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }
    await sendTelegramMessage(
      `✅ Добавлен в Big Brother:\n${result.site.name}\nid: ${result.site.id}\n${result.site.url}\n\nМожно сразу проверить:`,
      chatId,
      { reply_markup: siteActionsKeyboard(result.site.id) },
    );
  }
}

async function runCheckCommand(
  chatId: string,
  mode: "shallow" | "deep" | "full",
  siteFilter?: string,
): Promise<void> {
  let sites = await getManagedSites();
  if (siteFilter) {
    const found = await findManagedSite(siteFilter);
    if (!found) {
      await sendTelegramMessage(`Неизвестный сайт: ${siteFilter}`, chatId);
      return;
    }
    sites = [found];
  }

  const modeRu =
    mode === "shallow" ? "быстрый ping" : mode === "deep" ? "deep" : "full crawl";
  await sendTelegramMessage(
    `Запускаю ${modeRu}${siteFilter ? ` для ${sites[0]?.name}` : " для всех"}…`,
    chatId,
  );

  const { results, alertsSent } = await runHealthSweep(sites, { mode });

  if (results.length === 1) {
    const r = results[0]!;
    const site = sites.find((s) => s.id === r.siteId);
    await sendTelegramMessage(formatDetailedCheckReport(r, site?.name), chatId, {
      reply_markup: afterCheckKeyboard(r.siteId),
    });
    if (alertsSent > 0) {
      await sendTelegramMessage(`Алертов отправлено в личку: ${alertsSent}`, chatId);
    }
    return;
  }

  const lines = results.map((r) => {
    const site = sites.find((s) => s.id === r.siteId);
    return formatStatusLine(r, site?.name ?? r.siteId);
  });
  lines.push(`\nалертов в личку: ${alertsSent}`);
  lines.push("Нажми сайт в /sites для подробного отчёта.");
  await sendTelegramMessage(lines.join("\n"), chatId, {
    reply_markup: sitesListKeyboard(sites),
  });
}

function formatSitesList(sites: SiteConfig[]): string {
  if (sites.length === 0) return "Список пуст. Добавь сайт кнопкой ➕";
  return [
    `Сайтов в мониторинге: ${sites.length}`,
    "",
    ...sites.map(
      (s) => `• ${s.name}\n  id: ${s.id}\n  ${s.url} (${s.host})`,
    ),
    "",
    "Нажми сайт ниже для подробной проверки / удаления.",
  ].join("\n");
}

async function formatProbes(siteId?: string): Promise<string> {
  const sites = await getManagedSites();
  const filtered = siteId
    ? sites.filter(
        (s) =>
          s.id === siteId || s.name.toLowerCase() === siteId.toLowerCase(),
      )
    : sites;
  if (filtered.length === 0) return `Неизвестный сайт: ${siteId}`;
  return filtered
    .map((s) => {
      const cfg = getProbeConfig(s.id);
      return `• ${s.id}\n  ${describeProbeConfig(cfg)}`;
    })
    .join("\n\n");
}

async function formatStatus(): Promise<string> {
  const sites = await getManagedSites();
  const statuses = await getAllSiteStatuses(sites.map((s) => s.id));
  if (sites.length === 0) return "Нет сайтов. /add";
  return sites
    .map((s) => formatStatusLine(statuses[s.id] ?? null, s.name))
    .join("\n");
}

async function formatErrors(n: number): Promise<string> {
  const errors = await listErrors(n);
  if (errors.length === 0) {
    return "Сохранённых ошибок пока нет.\nОни появляются после падений и /errors от клиентских репортов.";
  }
  return [
    `Последние ошибки (${errors.length}):`,
    "",
    ...errors.map(formatErrorDetailed),
  ].join("\n\n");
}
