import { readFileSync, existsSync, readdirSync } from "fs";
import path from "path";
import type { SiteProbeConfig } from "@/lib/types";

const PROBES_DIR = path.join(process.cwd(), "probes");

let cache: Map<string, SiteProbeConfig> | null = null;

function loadAllFromDisk(): Map<string, SiteProbeConfig> {
  const map = new Map<string, SiteProbeConfig>();
  if (!existsSync(PROBES_DIR)) return map;
  for (const file of readdirSync(PROBES_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(path.join(PROBES_DIR, file), "utf8");
      const parsed = JSON.parse(raw) as SiteProbeConfig;
      if (parsed?.siteId) map.set(parsed.siteId, parsed);
    } catch (err) {
      console.error(`[bigbrother] failed to load probe ${file}`, err);
    }
  }
  return map;
}

/** Optional override: PROBES_JSON='[{siteId, pages, ...}]' */
function loadFromEnv(): Map<string, SiteProbeConfig> {
  const map = new Map<string, SiteProbeConfig>();
  const raw = process.env.PROBES_JSON;
  if (!raw) return map;
  try {
    const arr = JSON.parse(raw) as SiteProbeConfig[];
    for (const p of arr) {
      if (p?.siteId) map.set(p.siteId, p);
    }
  } catch {
    console.error("[bigbrother] invalid PROBES_JSON");
  }
  return map;
}

export function getProbeConfig(siteId: string): SiteProbeConfig {
  if (!cache) {
    cache = new Map([...loadAllFromDisk(), ...loadFromEnv()]);
  }
  return (
    cache.get(siteId) ?? {
      siteId,
      pages: [{ path: "/", name: "homepage", scanErrors: true, checkAssets: true }],
      crawl: {
        startPath: "/",
        maxPages: 6,
        sameOrigin: true,
        scanErrors: true,
        checkAssets: true,
      },
    }
  );
}

export function resolveEnvRef(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("env:")) {
    return process.env[value.slice(4)] ?? undefined;
  }
  return value;
}

export function applyPlaceholders(value: string): string {
  return value
    .replaceAll("{{timestamp}}", String(Date.now()))
    .replaceAll("{{iso}}", new Date().toISOString())
    .replaceAll("{{uuid}}", cryptoRandom());
}

function cryptoRandom(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
