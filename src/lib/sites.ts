import type { SiteConfig } from "@/lib/types";

/**
 * Monitored projects. Add new sites here (or override via SITES_JSON env).
 * IDN domains use Unicode in display URL; fetch uses what Fetch API accepts.
 */
export const DEFAULT_SITES: SiteConfig[] = [
  {
    id: "zvezda-na-elku",
    name: "Звезда на ёлку",
    url: "https://xn-----6kcbhmgfkc3blw3g.xn--p1ai",
    host: "onreza",
  },
  {
    id: "doctor-ekazheva",
    name: "Фатима Экажева",
    url: "https://doctor-ekazheva.ru",
    host: "onreza",
  },
  {
    id: "kateramika",
    name: "Kateramika",
    url: "https://kateramika.ru",
    host: "other",
  },
  {
    id: "deal-poizon-delivery",
    name: "Deal Poizon Delivery",
    url: "https://deal-poizon-delivery.vercel.app",
    host: "vercel",
  },
];

export function getSites(): SiteConfig[] {
  const raw = process.env.SITES_JSON;
  if (!raw) return DEFAULT_SITES;
  try {
    const parsed = JSON.parse(raw) as SiteConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_SITES;
    return parsed;
  } catch {
    return DEFAULT_SITES;
  }
}

export function getSiteById(id: string): SiteConfig | undefined {
  return getSites().find((s) => s.id === id);
}

/** Async lookup including Redis add/remove overrides. */
export async function getSiteByIdManaged(
  id: string,
): Promise<SiteConfig | undefined> {
  const { findManagedSite } = await import("@/lib/site-registry");
  return findManagedSite(id);
}
