import type { SiteConfig, SiteHost } from "@/lib/types";
import { DEFAULT_SITES } from "@/lib/sites";
import {
  getExtraSites,
  getRemovedSiteIds,
  addExtraSite,
  removeSiteId,
  removeExtraSite,
  restoreSiteId,
} from "@/lib/redis";

function envSites(): SiteConfig[] {
  const raw = process.env.SITES_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SiteConfig[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s) => s && typeof s.id === "string" && typeof s.url === "string",
    );
  } catch {
    return [];
  }
}

function baseCatalog(): SiteConfig[] {
  const fromEnv = envSites();
  if (fromEnv.length > 0) return fromEnv;
  return DEFAULT_SITES;
}

/**
 * Effective site list = (DEFAULT/SITES_JSON + Redis extras) − Redis removals.
 * Allows Telegram /add and /remove without redeploy.
 */
export async function getManagedSites(): Promise<SiteConfig[]> {
  const [extra, removed] = await Promise.all([
    getExtraSites(),
    getRemovedSiteIds(),
  ]);
  const removedSet = new Set(removed);
  const byId = new Map<string, SiteConfig>();

  for (const site of baseCatalog()) {
    if (!removedSet.has(site.id)) byId.set(site.id, site);
  }
  for (const site of extra) {
    if (!removedSet.has(site.id)) byId.set(site.id, site);
  }

  return [...byId.values()];
}

export async function findManagedSite(
  idOrName: string,
): Promise<SiteConfig | undefined> {
  const q = idOrName.trim().toLowerCase();
  const sites = await getManagedSites();
  return sites.find(
    (s) =>
      s.id.toLowerCase() === q ||
      s.name.toLowerCase() === q ||
      s.url.toLowerCase().includes(q),
  );
}

export function slugifySiteId(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || `site-${Date.now()}`;
}

export function normalizeSiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function guessHost(url: string): SiteHost {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith(".vercel.app") || host.includes("vercel")) return "vercel";
    if (host.includes("onreza") || host.endsWith(".ru")) return "onreza";
    return "other";
  } catch {
    return "other";
  }
}

export async function addSiteFromTelegram(input: {
  url: string;
  name?: string;
  id?: string;
}): Promise<{ ok: true; site: SiteConfig } | { ok: false; error: string }> {
  const url = normalizeSiteUrl(input.url);
  if (!url) return { ok: false, error: "Некорректный URL. Пример: https://example.com" };

  const id = (input.id?.trim() || slugifySiteId(input.name || url)).slice(0, 64);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
    return {
      ok: false,
      error: "id должен быть латиницей/цифрами (a-z0-9_-), начинаться с буквы или цифры",
    };
  }

  const existing = await getManagedSites();
  if (existing.some((s) => s.id === id || s.url === url)) {
    return { ok: false, error: `Сайт уже есть в мониторинге (id=${id} или тот же URL)` };
  }

  const site: SiteConfig = {
    id,
    name: (input.name?.trim() || new URL(url).hostname).slice(0, 80),
    url,
    host: guessHost(url),
  };

  const saved = await addExtraSite(site);
  if (!saved) {
    return {
      ok: false,
      error: "Не удалось сохранить в Redis. Проверь UPSTASH_REDIS_* env.",
    };
  }
  return { ok: true, site };
}

export async function removeSiteFromTelegram(
  idOrName: string,
): Promise<{ ok: true; site: SiteConfig } | { ok: false; error: string }> {
  const site = await findManagedSite(idOrName);
  if (!site) return { ok: false, error: `Сайт «${idOrName}» не найден` };

  const okRemove = await removeSiteId(site.id);
  await removeExtraSite(site.id);
  if (!okRemove) {
    return { ok: false, error: "Не удалось удалить сайт из Redis" };
  }
  return { ok: true, site };
}

export async function undoRemoveSite(
  siteId: string,
): Promise<boolean> {
  return restoreSiteId(siteId);
}
