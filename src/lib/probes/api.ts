import type { ApiProbe, ProbeFinding } from "@/lib/types";
import { applyPlaceholders, resolveEnvRef } from "@/lib/probes/load";

function resolveHeaders(
  headers?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {
    "User-Agent": "BigBrotherMonitor/2.0 (+api-probe)",
    Accept: "application/json,text/plain,*/*",
  };
  if (!headers) return out;
  for (const [k, v] of Object.entries(headers)) {
    out[k] = resolveEnvRef(v) ?? applyPlaceholders(v);
  }
  return out;
}

export async function runApiProbe(
  baseUrl: string,
  probe: ApiProbe,
): Promise<ProbeFinding[]> {
  const url = new URL(probe.path, baseUrl).toString();
  const method = probe.method ?? "GET";
  const severity = probe.severity ?? "critical";
  const maxMs = probe.maxMs ?? 12_000;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs);

  try {
    let body: string | undefined;
    const headers = resolveHeaders(probe.headers);
    if (probe.body != null && method !== "GET" && method !== "HEAD") {
      if (typeof probe.body === "string") {
        body = applyPlaceholders(probe.body);
      } else {
        body = JSON.stringify(probe.body);
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      }
    }

    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    const latencyMs = Date.now() - started;
    const expect = probe.expectStatus ?? [200, 201, 204];
    let ok = expect.includes(res.status);
    let message = `API HTTP ${res.status}`;

    if (!ok) message = `API unexpected HTTP ${res.status}`;

    if (probe.expectTextIncludes && !text.includes(probe.expectTextIncludes)) {
      ok = false;
      message = `API missing text "${probe.expectTextIncludes}"`;
    }

    if (probe.expectJsonPath) {
      try {
        const json = JSON.parse(text) as unknown;
        const value = getPath(json, probe.expectJsonPath);
        if (value === undefined || value === null || value === false) {
          ok = false;
          message = `API JSON path "${probe.expectJsonPath}" missing/false`;
        }
      } catch {
        ok = false;
        message = "API response is not JSON";
      }
    }

    if (latencyMs > maxMs) {
      ok = false;
      message = `API too slow ${latencyMs}ms > ${maxMs}ms`;
    }

    return [
      {
        ok,
        kind: "api",
        name: probe.name,
        severity,
        message,
        url,
        latencyMs,
        meta: { status: res.status },
      },
    ];
  } catch (err) {
    return [
      {
        ok: false,
        kind: "api",
        name: probe.name,
        severity,
        message: `API failed: ${err instanceof Error ? err.message : String(err)}`,
        url,
        latencyMs: Date.now() - started,
      },
    ];
  } finally {
    clearTimeout(timer);
  }
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\$./, "").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
