import { Redis } from "@upstash/redis";
import type { ReportedError, SiteCheckResult, SiteConfig } from "@/lib/types";

const ERRORS_KEY = "bb:errors";
const STATUS_PREFIX = "bb:status:";
const MUTE_PREFIX = "bb:mute:";
const DEDUPE_PREFIX = "bb:dedupe:";
const EXTRA_SITES_KEY = "bb:sites:extra";
const REMOVED_SITES_KEY = "bb:sites:removed";
const DOWN_SINCE_PREFIX = "bb:down:since:";
const TG_STATE_PREFIX = "bb:tg:state:";
const MAX_ERRORS = 100;

let redis: Redis | null = null;
let warnedMissing = false;

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warnedMissing) {
      console.warn(
        "[bigbrother] UPSTASH_REDIS_REST_URL/TOKEN not set — status history disabled; Telegram alerts still work with weak dedupe",
      );
      warnedMissing = true;
    }
    return null;
  }
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

export async function saveSiteStatus(result: SiteCheckResult): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(`${STATUS_PREFIX}${result.siteId}`, result);
}

export async function getSiteStatus(
  siteId: string,
): Promise<SiteCheckResult | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<SiteCheckResult>(`${STATUS_PREFIX}${siteId}`)) ?? null;
}

export async function getAllSiteStatuses(
  siteIds: string[],
): Promise<Record<string, SiteCheckResult | null>> {
  const out: Record<string, SiteCheckResult | null> = {};
  await Promise.all(
    siteIds.map(async (id) => {
      out[id] = await getSiteStatus(id);
    }),
  );
  return out;
}

export async function pushError(error: ReportedError): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.lpush(ERRORS_KEY, error);
  await r.ltrim(ERRORS_KEY, 0, MAX_ERRORS - 1);
}

export async function listErrors(limit = 20): Promise<ReportedError[]> {
  const r = getRedis();
  if (!r) return [];
  const items = await r.lrange<ReportedError>(ERRORS_KEY, 0, limit - 1);
  return items ?? [];
}

export async function isMuted(siteId: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const v = await r.get<string>(`${MUTE_PREFIX}${siteId}`);
  return Boolean(v);
}

/** Mute site alerts for `minutes` (default 60). */
export async function muteSite(
  siteId: string,
  minutes = 60,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(`${MUTE_PREFIX}${siteId}`, "1", { ex: minutes * 60 });
}

export async function unmuteSite(siteId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(`${MUTE_PREFIX}${siteId}`);
}

const TG_OFFSET_KEY = "bb:tg:offset";
const TG_WEBHOOK_OK_KEY = "bb:tg:webhook_callbacks_ok";

export async function getTelegramOffset(): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  const v = await r.get<number | string>(TG_OFFSET_KEY);
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function setTelegramOffset(offset: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(TG_OFFSET_KEY, offset);
}

/** Cache that Telegram webhook accepts callback_query (avoid setWebhook every message). */
export async function isTelegramWebhookCallbacksOk(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  return Boolean(await r.get(TG_WEBHOOK_OK_KEY));
}

export async function markTelegramWebhookCallbacksOk(
  ttlSeconds = 6 * 60 * 60,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(TG_WEBHOOK_OK_KEY, "1", { ex: ttlSeconds });
}

export async function clearTelegramWebhookCallbacksOk(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(TG_WEBHOOK_OK_KEY);
}

const CRON_LAST_KEY = "bb:cron:last";

export type CronLastRun = {
  at: string;
  mode: string;
  source: string;
  checked: number;
  alertsSent: number;
  down: number;
  degraded: number;
};

export async function saveCronLastRun(run: CronLastRun): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(CRON_LAST_KEY, run);
}

export async function getCronLastRun(): Promise<CronLastRun | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<CronLastRun>(CRON_LAST_KEY)) ?? null;
}

/**
 * Returns true if this key was newly set (not a duplicate within TTL).
 */
export async function claimDedupe(
  key: string,
  ttlSeconds: number,
): Promise<boolean> {
  const r = getRedis();
  if (!r) return true;
  const full = `${DEDUPE_PREFIX}${key}`;
  const ok = await r.set(full, "1", { nx: true, ex: ttlSeconds });
  return ok === "OK";
}

/** ---- Managed sites (Telegram add/remove) ---- */

export async function getExtraSites(): Promise<SiteConfig[]> {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.get<SiteConfig[] | string>(EXTRA_SITES_KEY);
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as SiteConfig[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

export async function addExtraSite(site: SiteConfig): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const list = await getExtraSites();
  const next = [...list.filter((s) => s.id !== site.id), site];
  await r.set(EXTRA_SITES_KEY, next);
  // If it was previously soft-removed, restore it
  await restoreSiteId(site.id);
  return true;
}

export async function removeExtraSite(siteId: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const list = await getExtraSites();
  const next = list.filter((s) => s.id !== siteId);
  await r.set(EXTRA_SITES_KEY, next);
  return true;
}

export async function getRemovedSiteIds(): Promise<string[]> {
  const r = getRedis();
  if (!r) return [];
  const raw = await r.get<string[] | string>(REMOVED_SITES_KEY);
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? raw : [];
}

export async function removeSiteId(siteId: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const list = await getRemovedSiteIds();
  if (!list.includes(siteId)) {
    await r.set(REMOVED_SITES_KEY, [...list, siteId]);
  }
  return true;
}

export async function restoreSiteId(siteId: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  const list = await getRemovedSiteIds();
  await r.set(
    REMOVED_SITES_KEY,
    list.filter((id) => id !== siteId),
  );
  return true;
}

/** ---- Downtime tracking for escalation alerts ---- */

export async function getDownSince(siteId: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  const v = await r.get<string>(`${DOWN_SINCE_PREFIX}${siteId}`);
  return v ?? null;
}

export async function markDownSince(
  siteId: string,
  iso?: string,
): Promise<string> {
  const r = getRedis();
  const at = iso ?? new Date().toISOString();
  if (!r) return at;
  const existing = await getDownSince(siteId);
  if (existing) return existing;
  await r.set(`${DOWN_SINCE_PREFIX}${siteId}`, at);
  return at;
}

export async function clearDownSince(siteId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(`${DOWN_SINCE_PREFIX}${siteId}`);
}

/** ---- Telegram conversation state (add flow) ---- */

export type TelegramChatState =
  | { step: "add_url" }
  | { step: "add_name"; url: string }
  | { step: "remove_pick" };

export async function getTelegramChatState(
  chatId: string,
): Promise<TelegramChatState | null> {
  const r = getRedis();
  if (!r) return null;
  return (await r.get<TelegramChatState>(`${TG_STATE_PREFIX}${chatId}`)) ?? null;
}

export async function setTelegramChatState(
  chatId: string,
  state: TelegramChatState | null,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  const key = `${TG_STATE_PREFIX}${chatId}`;
  if (!state) {
    await r.del(key);
    return;
  }
  await r.set(key, state, { ex: 15 * 60 });
}
