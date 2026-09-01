import type { ProbeFinding } from "@/lib/types";

export async function checkAssetUrls(
  urls: string[],
  opts: {
    maxBytes: number;
    maxMs: number;
    parentName: string;
  },
): Promise<ProbeFinding[]> {
  const findings: ProbeFinding[] = [];
  const limited = urls.slice(0, 10);

  await Promise.all(
    limited.map(async (url) => {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.maxMs + 2000);
      try {
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          cache: "no-store",
          headers: {
            "User-Agent": "BigBrotherMonitor/2.0 (+asset-probe)",
          },
        });
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          findings.push({
            ok: false,
            kind: "asset",
            name: `${opts.parentName}:asset`,
            severity: "critical",
            message: `Asset HTTP ${res.status}`,
            url,
            latencyMs,
          });
          return;
        }

        // Prefer content-length; otherwise read with cap
        const lenHeader = res.headers.get("content-length");
        let size = lenHeader ? Number(lenHeader) : NaN;
        if (!Number.isFinite(size)) {
          const buf = await res.arrayBuffer();
          size = buf.byteLength;
        } else {
          // drain body lightly
          await res.arrayBuffer().catch(() => undefined);
        }

        if (latencyMs > opts.maxMs) {
          findings.push({
            ok: false,
            kind: "asset",
            name: `${opts.parentName}:asset-slow`,
            severity: "warning",
            message: `Asset slow on weak-net budget: ${latencyMs}ms > ${opts.maxMs}ms (${Math.round(size / 1024)}KB)`,
            url,
            latencyMs,
            meta: { size },
          });
        } else if (size > opts.maxBytes) {
          findings.push({
            ok: false,
            kind: "asset",
            name: `${opts.parentName}:asset-heavy`,
            severity: "warning",
            message: `Asset heavy: ${size} bytes > ${opts.maxBytes}`,
            url,
            latencyMs,
            meta: { size },
          });
        }
      } catch (err) {
        findings.push({
          ok: false,
          kind: "asset",
          name: `${opts.parentName}:asset`,
          severity: "critical",
          message: `Asset failed: ${err instanceof Error ? err.message : String(err)}`,
          url,
          latencyMs: Date.now() - started,
        });
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return findings;
}
