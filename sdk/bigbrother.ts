/**
 * Big Brother client SDK — copy into any site (browser or Next.js client).
 *
 * Usage:
 *   import { initBigBrother } from "./bigbrother";
 *   initBigBrother({
 *     endpoint: "https://YOUR-BIGBROTHER.vercel.app/api/report",
 *     secret: process.env.NEXT_PUBLIC_BIGBROTHER_SECRET!, // or hardcode report secret only if you accept the risk
 *     siteId: "deal-poizon-delivery",
 *   });
 *
 * Prefer keeping the secret server-side and proxying via your own /api/report-proxy.
 */

export type BigBrotherInit = {
  endpoint: string;
  /** Omit when endpoint is your same-origin proxy that adds the real secret */
  secret?: string;
  siteId: string;
  /** Extra fields attached to every report */
  meta?: Record<string, unknown>;
};

let configured: BigBrotherInit | null = null;

export function initBigBrother(config: BigBrotherInit): void {
  if (typeof window === "undefined") return;
  configured = config;

  window.addEventListener("error", (event) => {
    void reportError({
      message: event.message || "window.error",
      stack: event.error instanceof Error ? event.error.stack : undefined,
      url: location.href,
      source: "client",
      meta: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "unhandledrejection";
    const stack = reason instanceof Error ? reason.stack : undefined;
    void reportError({
      message,
      stack,
      url: location.href,
      source: "client",
      meta: { type: "unhandledrejection" },
    });
  });
}

export async function reportError(input: {
  message: string;
  stack?: string;
  url?: string;
  source?: "client" | "server" | "unknown";
  meta?: Record<string, unknown>;
}): Promise<void> {
  if (!configured) {
    console.warn("[bigbrother] not initialized");
    return;
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (configured.secret) {
      headers.Authorization = `Bearer ${configured.secret}`;
    }
    await fetch(configured.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        siteId: configured.siteId,
        message: input.message,
        stack: input.stack,
        url: input.url,
        source: input.source ?? "unknown",
        meta: { ...configured.meta, ...input.meta },
      }),
      keepalive: true,
    });
  } catch {
    // swallow — monitoring must not break the app
  }
}

/** Server-side helper (Node / Edge). Pass config explicitly. */
export async function reportServerError(
  config: BigBrotherInit,
  input: {
    message: string;
    stack?: string;
    url?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.secret}`,
      },
      body: JSON.stringify({
        siteId: config.siteId,
        message: input.message,
        stack: input.stack,
        url: input.url,
        source: "server",
        meta: { ...config.meta, ...input.meta },
      }),
    });
  } catch {
    // ignore
  }
}
