import type { SiteCheckResult, SiteConfig, SiteStatus } from "@/lib/types";

const DEFAULT_TIMEOUT_MS = 12_000;

export async function checkSite(
  site: SiteConfig,
  timeoutMs = 18_000,
): Promise<SiteCheckResult> {
  const path = site.healthPath ?? "/";
  const url = new URL(path, site.url).toString();
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "BigBrotherMonitor/1.0 (+https://github.com/bigbrother)",
        Accept: "text/html,application/json,*/*",
      },
      cache: "no-store",
    });

    const latencyMs = Date.now() - started;
    const status: SiteStatus =
      res.status >= 200 && res.status < 400 ? "up" : "down";

    return {
      siteId: site.id,
      status,
      httpStatus: res.status,
      latencyMs,
      error:
        status === "down"
          ? `HTTP ${res.status} ${res.statusText || ""}`.trim()
          : null,
      checkedAt: new Date().toISOString(),
      url,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout after ${timeoutMs}ms`
          : err.message
        : String(err);

    return {
      siteId: site.id,
      status: "down",
      httpStatus: null,
      latencyMs: Date.now() - started,
      error: message,
      checkedAt: new Date().toISOString(),
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAllSites(
  sites: SiteConfig[],
): Promise<SiteCheckResult[]> {
  return Promise.all(sites.map((s) => checkSite(s)));
}
