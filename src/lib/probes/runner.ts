import type {
  ProbeFinding,
  SiteCheckResult,
  SiteConfig,
  SiteProbeConfig,
  SiteStatus,
} from "@/lib/types";
import { getProbeConfig } from "@/lib/probes/load";
import { runPageProbe } from "@/lib/probes/page";
import { runCrawlProbe } from "@/lib/probes/crawl";
import { runFormProbe } from "@/lib/probes/forms";
import { runApiProbe } from "@/lib/probes/api";
import { runDbProbe } from "@/lib/probes/db";
import { checkAssetUrls } from "@/lib/probes/assets";
import { checkSite } from "@/lib/health";

export type DeepRunOptions = {
  /** shallow = HTTP only; deep = pages+assets+forms+api+db; full = +crawl */
  mode?: "shallow" | "deep" | "full";
};

export async function runSiteProbes(
  site: SiteConfig,
  options: DeepRunOptions = {},
): Promise<SiteCheckResult> {
  const mode = options.mode ?? "deep";
  const basic = await checkSite(site);
  const findings: ProbeFinding[] = [
    {
      ok: basic.status === "up",
      kind: "http",
      name: "http-root",
      severity: "critical",
      message:
        basic.status === "up"
          ? `HTTP ${basic.httpStatus}`
          : (basic.error ?? "down"),
      url: basic.url,
      latencyMs: basic.latencyMs ?? undefined,
    },
  ];

  if (mode === "shallow") {
    return finalize(site, basic, findings);
  }

  // If site is completely down, skip expensive probes
  if (basic.status === "down") {
    return finalize(site, basic, findings);
  }

  const config = getProbeConfig(site.id);
  const tasks: Array<Promise<ProbeFinding[]>> = [];

  for (const page of config.pages ?? [
    { path: "/", name: "homepage", scanErrors: true, checkAssets: true },
  ]) {
    tasks.push(runPageProbe(site.url, page));
  }

  for (const form of config.forms ?? []) {
    tasks.push(runFormProbe(site.url, form));
  }

  for (const api of config.apis ?? []) {
    tasks.push(runApiProbe(site.url, api));
  }

  for (const db of config.databases ?? []) {
    tasks.push(runDbProbe(db));
  }

  for (const asset of config.assets ?? []) {
    const url = new URL(asset.path, site.url).toString();
    tasks.push(
      checkAssetUrls([url], {
        maxBytes: asset.maxBytes ?? 1_500_000,
        maxMs: asset.maxMs ?? 8_000,
        parentName: asset.name ?? "asset",
      }),
    );
  }

  if (mode === "full" && config.crawl) {
    tasks.push(runCrawlProbe(site.url, config.crawl));
  } else if (mode === "full" && !config.crawl) {
    tasks.push(
      runCrawlProbe(site.url, {
        startPath: "/",
        maxPages: 6,
        scanErrors: true,
        checkAssets: true,
      }),
    );
  }

  const batches = await Promise.all(tasks);
  for (const batch of batches) findings.push(...batch);

  return finalize(site, basic, findings);
}

export async function runAllSiteProbes(
  sites: SiteConfig[],
  options: DeepRunOptions = {},
): Promise<SiteCheckResult[]> {
  // Sequential-ish to stay under Hobby duration / connection limits:
  // run 2 at a time
  const out: SiteCheckResult[] = [];
  for (let i = 0; i < sites.length; i += 2) {
    const chunk = sites.slice(i, i + 2);
    const results = await Promise.all(
      chunk.map((s) => runSiteProbes(s, options)),
    );
    out.push(...results);
  }
  return out;
}

function finalize(
  site: SiteConfig,
  basic: SiteCheckResult,
  findings: ProbeFinding[],
): SiteCheckResult {
  const failed = findings.filter((f) => !f.ok);
  const criticalFails = failed.filter((f) => f.severity === "critical");
  const warnings = failed.filter((f) => f.severity === "warning");

  let status: SiteStatus = "up";
  if (basic.status === "down" || criticalFails.length > 0) status = "down";
  else if (warnings.length > 0) status = "degraded";

  const error =
    failed.length > 0
      ? failed
          .slice(0, 5)
          .map((f) => `[${f.kind}] ${f.name}: ${f.message}`)
          .join(" | ")
      : null;

  // Keep payload small for Redis
  const compactFindings = findings
    .filter((f) => !f.ok)
    .slice(0, 40)
    .map((f) => ({
      ...f,
      meta: undefined,
    }));

  return {
    siteId: site.id,
    status,
    httpStatus: basic.httpStatus,
    latencyMs: basic.latencyMs,
    error,
    checkedAt: new Date().toISOString(),
    url: basic.url,
    probeSummary: {
      total: findings.length,
      failed: criticalFails.length,
      warnings: warnings.length,
    },
    findings: compactFindings,
  };
}

export function describeProbeConfig(config: SiteProbeConfig): string {
  return [
    `pages: ${config.pages?.length ?? 0}`,
    `forms: ${config.forms?.length ?? 0}`,
    `apis: ${config.apis?.length ?? 0}`,
    `dbs: ${config.databases?.length ?? 0}`,
    `assets: ${config.assets?.length ?? 0}`,
    `crawl: ${config.crawl ? "yes" : "default"}`,
  ].join(", ");
}
