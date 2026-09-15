import type { SiteConfig } from "@/lib/types";

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

/** Telegram callback_data max 64 bytes — keep compact. */
export const CB = {
  menu: "m",
  status: "st",
  sites: "ls",
  errors: "er",
  help: "hp",
  add: "ad",
  checkAll: "ca",
  deepAll: "da",
  site: (id: string) => `s:${id}`,
  check: (id: string) => `c:${id}`,
  deep: (id: string) => `d:${id}`,
  full: (id: string) => `f:${id}`,
  remove: (id: string) => `rm:${id}`,
  removeConfirm: (id: string) => `rc:${id}`,
  cancel: "x",
} as const;

export function mainMenuKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "📊 Статус", callback_data: CB.status },
        { text: "🗂 Сайты", callback_data: CB.sites },
      ],
      [
        { text: "⚡ Проверить все", callback_data: CB.checkAll },
        { text: "🔬 Deep все", callback_data: CB.deepAll },
      ],
      [
        { text: "➕ Добавить сайт", callback_data: CB.add },
        { text: "🧾 Ошибки", callback_data: CB.errors },
      ],
      [{ text: "❓ Справка", callback_data: CB.help }],
    ],
  };
}

export function sitesListKeyboard(sites: SiteConfig[]): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = sites.map((s) => [
    {
      text: `🔎 ${s.name}`.slice(0, 40),
      callback_data: CB.site(s.id).slice(0, 64),
    },
  ]);
  rows.push([
    { text: "➕ Добавить", callback_data: CB.add },
    { text: "🏠 Меню", callback_data: CB.menu },
  ]);
  return { inline_keyboard: rows };
}

export function siteActionsKeyboard(siteId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "⚡ Ping", callback_data: CB.check(siteId).slice(0, 64) },
        { text: "🔬 Deep", callback_data: CB.deep(siteId).slice(0, 64) },
        { text: "🕸 Full", callback_data: CB.full(siteId).slice(0, 64) },
      ],
      [
        { text: "🗑 Удалить", callback_data: CB.remove(siteId).slice(0, 64) },
        { text: "🗂 К списку", callback_data: CB.sites },
      ],
      [{ text: "🏠 Меню", callback_data: CB.menu }],
    ],
  };
}

export function afterCheckKeyboard(siteId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "🔄 Ещё раз (deep)", callback_data: CB.deep(siteId).slice(0, 64) },
        { text: "⚡ Ping", callback_data: CB.check(siteId).slice(0, 64) },
      ],
      [
        { text: "🗂 Сайты", callback_data: CB.sites },
        { text: "🏠 Меню", callback_data: CB.menu },
      ],
    ],
  };
}

export function confirmRemoveKeyboard(siteId: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Да, удалить",
          callback_data: CB.removeConfirm(siteId).slice(0, 64),
        },
        { text: "✖️ Отмена", callback_data: CB.cancel },
      ],
    ],
  };
}

export function cancelKeyboard(): InlineKeyboard {
  return {
    inline_keyboard: [[{ text: "✖️ Отмена", callback_data: CB.cancel }]],
  };
}

export const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: "start", description: "Меню с кнопками" },
  { command: "help", description: "Описание всех команд и алертов" },
  { command: "status", description: "Последние статусы сайтов" },
  { command: "sites", description: "Список сайтов + кнопки" },
  { command: "check", description: "Быстрый HTTP-пинг [id]" },
  { command: "deep", description: "Глубокая проверка [id]" },
  { command: "full", description: "Deep + crawl [id]" },
  { command: "add", description: "Добавить сайт в мониторинг" },
  { command: "remove", description: "Удалить сайт [id]" },
  { command: "errors", description: "Последние ошибки с логами" },
  { command: "probes", description: "Что проверяется [id]" },
  { command: "mute", description: "Заглушить алерты <id> [мин]" },
  { command: "unmute", description: "Снова слать алерты <id>" },
  { command: "chatid", description: "Показать chat id" },
];
