import * as cheerio from "cheerio";
import type { PageProbe, ProbeFinding } from "@/lib/types";
import {
  extractSameOriginAssets,
  fetchText,
  scanHtmlForErrors,
} from "@/lib/probes/html";
import { checkAssetUrls } from "@/lib/probes/assets";

export async function runPageProbe(
  baseUrl: string,
  probe: PageProbe,
): Promise<ProbeFinding[]> {
  const url = new URL(probe.path || "/", baseUrl).toString();
  const name = probe.name ?? `page:${probe.path}`;
  const findings: ProbeFinding[] = [];

  // Fetch timeout is separate from weak-net TTFB budget (slow hosts like Onreza).
  const fetchTimeout = Math.max(probe.maxTtfbMs ?? 0, 18_000);
  const res = await fetchText(url, { timeoutMs: fetchTimeout });

  if (res.error || res.status === 0) {
    findings.push({
      ok: false,
      kind: "page",
      name,
      severity: "critical",
      message: `Page fetch failed: ${res.error ?? "unknown"}`,
      url,
      latencyMs: res.latencyMs,
    });
    return findings;
  }

  if (res.status >= 400) {
    findings.push({
      ok: false,
      kind: "page",
      name,
      severity: "critical",
      message: `HTTP ${res.status}`,
      url,
      latencyMs: res.latencyMs,
    });
    return findings;
  }

  const maxHtml = probe.maxHtmlBytes ?? 2_500_000;
  if (res.text.length > maxHtml) {
    findings.push({
      ok: false,
      kind: "page",
      name: `${name}:html-size`,
      severity: "warning",
      message: `HTML too large for weak networks: ${res.text.length} bytes > ${maxHtml}`,
      url,
      latencyMs: res.latencyMs,
    });
  }

  if (probe.maxTtfbMs && res.latencyMs > probe.maxTtfbMs) {
    findings.push({
      ok: false,
      kind: "page",
      name: `${name}:ttfb`,
      severity: "warning",
      message: `Slow TTFB ${res.latencyMs}ms > ${probe.maxTtfbMs}ms (weak-net budget)`,
      url,
      latencyMs: res.latencyMs,
    });
  }

  const $ = cheerio.load(res.text);

  for (const assert of probe.assert ?? []) {
    if (assert.selector) {
      const count = $(assert.selector).length;
      if (count === 0) {
        findings.push({
          ok: false,
          kind: "page",
          name: `${name}:selector`,
          severity: "critical",
          message: `Missing selector "${assert.selector}"`,
          url,
        });
      }
    }
    if (assert.textIncludes && !res.text.includes(assert.textIncludes)) {
      findings.push({
        ok: false,
        kind: "page",
        name: `${name}:text`,
        severity: "critical",
        message: `Missing text "${assert.textIncludes}"`,
        url,
      });
    }
    if (assert.textExcludes && res.text.includes(assert.textExcludes)) {
      findings.push({
        ok: false,
        kind: "page",
        name: `${name}:forbidden-text`,
        severity: "critical",
        message: `Forbidden text present "${assert.textExcludes}"`,
        url,
      });
    }
    if (assert.titleIncludes) {
      const title = $("title").text();
      if (!title.includes(assert.titleIncludes)) {
        findings.push({
          ok: false,
          kind: "page",
          name: `${name}:title`,
          severity: "warning",
          message: `Title missing "${assert.titleIncludes}" (got: ${title.slice(0, 80)})`,
          url,
        });
      }
    }
  }

  if (probe.scanErrors !== false) {
    findings.push(...scanHtmlForErrors(res.text, url));
  }

  if (probe.checkAssets !== false) {
    const assets = extractSameOriginAssets(res.text, url, 10);
    findings.push(
      ...(await checkAssetUrls(assets, {
        maxBytes: probe.maxAssetBytes ?? 1_500_000,
        maxMs: probe.maxAssetMs ?? 8_000,
        parentName: name,
      })),
    );
  }

  if (findings.every((f) => f.ok !== false) || findings.length === 0) {
    findings.push({
      ok: true,
      kind: "page",
      name,
      severity: "critical",
      message: `OK HTTP ${res.status}`,
      url,
      latencyMs: res.latencyMs,
    });
  }

  return findings;
}
