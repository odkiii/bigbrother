import type { CrawlProbe, ProbeFinding } from "@/lib/types";
import {
  extractInternalLinks,
  extractSameOriginAssets,
  fetchText,
  scanHtmlForErrors,
} from "@/lib/probes/html";
import { checkAssetUrls } from "@/lib/probes/assets";

export async function runCrawlProbe(
  baseUrl: string,
  probe: CrawlProbe,
): Promise<ProbeFinding[]> {
  const maxPages = Math.min(probe.maxPages ?? 6, 10);
  const start = new URL(probe.startPath ?? "/", baseUrl).toString();
  const queue: string[] = [start];
  const seen = new Set<string>();
  const findings: ProbeFinding[] = [];
  let visited = 0;

  while (queue.length && visited < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    visited += 1;

    const res = await fetchText(url, { timeoutMs: 12_000 });
    if (res.status === 0 || res.error) {
      findings.push({
        ok: false,
        kind: "crawl",
        name: `crawl:${new URL(url).pathname}`,
        severity: "critical",
        message: `Crawl fetch failed: ${res.error ?? "unknown"}`,
        url,
        latencyMs: res.latencyMs,
      });
      continue;
    }

    if (res.status >= 400) {
      findings.push({
        ok: false,
        kind: "crawl",
        name: `crawl:${new URL(url).pathname}`,
        severity: "critical",
        message: `Crawl HTTP ${res.status}`,
        url,
        latencyMs: res.latencyMs,
      });
      continue;
    }

    if (probe.scanErrors !== false) {
      findings.push(...scanHtmlForErrors(res.text, url));
    }

    if (probe.checkAssets) {
      const assets = extractSameOriginAssets(res.text, url, 6);
      findings.push(
        ...(await checkAssetUrls(assets, {
          maxBytes: probe.maxAssetBytes ?? 1_500_000,
          maxMs: probe.maxAssetMs ?? 8_000,
          parentName: `crawl:${new URL(url).pathname}`,
        })),
      );
    }

    findings.push({
      ok: true,
      kind: "crawl",
      name: `crawl:${new URL(url).pathname}`,
      severity: "critical",
      message: `OK HTTP ${res.status}`,
      url,
      latencyMs: res.latencyMs,
    });

    if (probe.sameOrigin !== false) {
      for (const link of extractInternalLinks(res.text, url, 15)) {
        if (!seen.has(link)) queue.push(link);
      }
    }
  }

  findings.push({
    ok: true,
    kind: "crawl",
    name: "crawl:summary",
    severity: "critical",
    message: `Crawled ${visited} page(s)`,
    url: start,
    meta: { visited, queuedLeft: queue.length },
  });

  return findings;
}
