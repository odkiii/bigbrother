/**
 * Big Brother client SDK — copy into any site (browser or Next.js client).
 *
 * Catches: window errors, unhandled rejections, failed fetch/XHR (wrapFetch),
 * and optional form submit hooks.
 */

export type BigBrotherInit = {
  endpoint: string;
  /** Omit when endpoint is your same-origin proxy that adds the real secret */
  secret?: string;
  siteId: string;
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

/** Wrap fetch to report non-OK API responses and network failures. */
export function wrapFetch(
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    try {
      const res = await baseFetch(input, init);
      if (res.status >= 500) {
        void reportError({
          message: `fetch ${res.status} ${url}`,
          url: typeof location !== "undefined" ? location.href : url,
          source: "client",
          meta: { type: "fetch", status: res.status, requestUrl: url },
        });
      }
      return res;
    } catch (err) {
      void reportError({
        message: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        url: typeof location !== "undefined" ? location.href : url,
        source: "client",
        meta: { type: "fetch-network", requestUrl: url },
      });
      throw err;
    }
  };
}

/** Call after a form submit that failed client-side validation or server response. */
export function reportFormFailure(input: {
  formName: string;
  message: string;
  url?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  return reportError({
    message: `form:${input.formName}: ${input.message}`,
    url: input.url ?? (typeof location !== "undefined" ? location.href : undefined),
    source: "client",
    meta: { type: "form", ...input.meta },
  });
}

export async function reportError(input: {
  message: string;
  stack?: string;
  url?: string;
  source?: "client" | "server" | "probe" | "unknown";
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
    // swallow
  }
}

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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.secret) headers.Authorization = `Bearer ${config.secret}`;
    await fetch(config.endpoint, {
      method: "POST",
      headers,
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
