import { Redis } from "@upstash/redis";
import type { ReportedError, SiteCheckResult } from "@/lib/types";

const ERRORS_KEY = "bb:errors";
const STATUS_PREFIX = "bb:status:";
const MUTE_PREFIX = "bb:mute:";
const DEDUPE_PREFIX = "bb:dedupe:";
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
