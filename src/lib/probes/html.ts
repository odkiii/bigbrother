import * as cheerio from "cheerio";
import type { ProbeFinding, ProbeSeverity } from "@/lib/types";

export const DEFAULT_ERROR_SIGNATURES = [
  /Fatal error:/i,
  /Parse error:/i,
  /Warning:[\s\S]{0,80}on line \d+/i,
  /Uncaught (?:Error|Exception|TypeError|ReferenceError)/i,
  /Nest\s*error/i,
  /Application error:/i,
  /Internal Server Error/i,
  /This page couldn’t load/i,
  /This page couldn['’]t load/i,
  /Something went wrong/i,
  /Unhandled Runtime Error/i,
  /Server Error/i,
  /A client-side exception has occurred/i,
  /NEXT_NOT_FOUND/i,
  /PrismaClient/i,
  /ECONNREFUSED/i,
  /SQLSTATE\[/i,
  /mysqli_/i,
  /pg_query\(/i,
  /Traceback \(most recent call last\)/i,
  /<title>\s*Error\s*<\/title>/i,
];

export function scanHtmlForErrors(
  html: string,
  url: string,
  severity: ProbeSeverity = "critical",
): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  for (const re of DEFAULT_ERROR_SIGNATURES) {
    const m = html.match(re);
    if (m) {
      findings.push({
        ok: false,
        kind: "html_error",
        name: "html-error-signature",
        severity,
        message: `Found error signature in HTML: ${m[0].slice(0, 120)}`,
        url,
        meta: { pattern: String(re) },
      });
      break;
    }
  }
  return findings;
}

export function extractSameOriginAssets(
  html: string,
  pageUrl: string,
  limit = 12,
): string[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined) => {
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return;
    try {
      const abs = new URL(raw, pageUrl);
      if (abs.origin !== base.origin) return;
      const href = abs.toString();
      if (seen.has(href)) return;
      seen.add(href);
      out.push(href);
    } catch {
      /* ignore */
    }
  };

  $("link[rel='stylesheet'][href]").each((_, el) => push($(el).attr("href")));
  $("script[src]").each((_, el) => push($(el).attr("src")));
  // critical images above the fold — first few
  $("img[src]").each((_, el) => {
    if (out.length >= limit) return false;
    push($(el).attr("src"));
  });

  return out.slice(0, limit);
}

export function extractInternalLinks(
  html: string,
  pageUrl: string,
  limit = 20,
): string[] {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const out: string[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
      return;
    try {
      const abs = new URL(href, pageUrl);
      if (abs.origin !== base.origin) return;
      abs.hash = "";
      const s = abs.toString();
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    } catch {
      /* ignore */
    }
  });

  return out.slice(0, limit);
}

export async function fetchText(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  latencyMs: number;
  error?: string;
  headers: Headers;
}> {
  const timeoutMs = init?.timeoutMs ?? 12_000;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "BigBrotherMonitor/2.0 (+synthetic-probes)",
        Accept: "text/html,application/json,*/*",
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
      latencyMs: Date.now() - started,
      headers: res.headers,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: "",
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
      headers: new Headers(),
    };
  } finally {
    clearTimeout(timer);
  }
}
