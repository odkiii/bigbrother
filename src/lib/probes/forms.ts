import * as cheerio from "cheerio";
import type { FormProbe, ProbeFinding } from "@/lib/types";
import { applyPlaceholders } from "@/lib/probes/load";
import { fetchText } from "@/lib/probes/html";

export async function runFormProbe(
  baseUrl: string,
  probe: FormProbe,
): Promise<ProbeFinding[]> {
  const pageUrl = new URL(probe.pagePath, baseUrl).toString();
  const mode = probe.mode ?? "auto";
  const severity = probe.severity ?? "critical";
  const findings: ProbeFinding[] = [];

  const page = await fetchText(pageUrl);
  if (!page.ok && page.status >= 400) {
    return [
      {
        ok: false,
        kind: "form",
        name: probe.name,
        severity,
        message: `Form page HTTP ${page.status || page.error}`,
        url: pageUrl,
        latencyMs: page.latencyMs,
      },
    ];
  }

  const $ = cheerio.load(page.text);
  const form = probe.formSelector
    ? $(probe.formSelector).first()
    : $("form").first();

  if (!form.length) {
    return [
      {
        ok: false,
        kind: "form",
        name: probe.name,
        severity,
        message: `Form not found (selector: ${probe.formSelector ?? "form"})`,
        url: pageUrl,
      },
    ];
  }

  const actionRaw = form.attr("action") || pageUrl;
  const method = (form.attr("method") || "POST").toUpperCase();
  const actionUrl = new URL(actionRaw, pageUrl).toString();

  if (mode === "discover") {
    const head = await fetchText(actionUrl, { method: "GET", timeoutMs: 10_000 });
    const reachable = head.status > 0 && head.status < 500;
    findings.push({
      ok: reachable,
      kind: "form",
      name: probe.name,
      severity,
      message: reachable
        ? `Form discovered; action reachable HTTP ${head.status}`
        : `Form action unreachable: ${head.error ?? head.status}`,
      url: actionUrl,
      latencyMs: head.latencyMs,
      meta: { method, pageUrl },
    });
    return findings;
  }

  // Collect hidden fields + configured fields
  const body = new URLSearchParams();
  form.find("input[type='hidden'][name]").each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") ?? "";
    if (name) body.set(name, value);
  });

  for (const [k, v] of Object.entries(probe.fields)) {
    body.set(k, applyPlaceholders(v));
  }

  // Also fill empty text/email inputs if named in fields only — already done

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(actionUrl, {
      method: method === "GET" ? "GET" : "POST",
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "BigBrotherMonitor/2.0 (+form-probe)",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/json,*/*",
        Referer: pageUrl,
      },
      body: method === "GET" ? undefined : body.toString(),
    });

    const text = await res.text().catch(() => "");
    const latencyMs = Date.now() - started;
    const expect = probe.expectStatus ?? [200, 201, 202, 204, 301, 302, 303, 307, 308];
    const statusOk = expect.includes(res.status);

    let ok = statusOk;
    let message = `Form submit HTTP ${res.status}`;

    if (!statusOk) {
      message = `Form submit unexpected HTTP ${res.status}`;
      ok = false;
    }
    if (probe.expectTextIncludes && !text.includes(probe.expectTextIncludes)) {
      ok = false;
      message = `Form response missing "${probe.expectTextIncludes}"`;
    }
    if (probe.expectTextExcludes && text.includes(probe.expectTextExcludes)) {
      ok = false;
      message = `Form response contains forbidden "${probe.expectTextExcludes}"`;
    }

    // Common failure markers
    const failMarkers = [
      /SQLSTATE\[/i,
      /Fatal error:/i,
      /Integrity constraint/i,
      /could not insert/i,
      /Database error/i,
      /500 Internal/i,
    ];
    for (const re of failMarkers) {
      if (re.test(text)) {
        ok = false;
        message = `Form response looks like backend/DB failure: ${text.match(re)?.[0]}`;
        break;
      }
    }

    findings.push({
      ok,
      kind: "form",
      name: probe.name,
      severity,
      message,
      url: actionUrl,
      latencyMs,
      meta: { method, pageUrl, status: res.status },
    });
  } catch (err) {
    findings.push({
      ok: false,
      kind: "form",
      name: probe.name,
      severity,
      message: `Form submit failed: ${err instanceof Error ? err.message : String(err)}`,
      url: actionUrl,
      latencyMs: Date.now() - started,
    });
  } finally {
    clearTimeout(timer);
  }

  return findings;
}
