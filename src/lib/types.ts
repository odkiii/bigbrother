export type SiteHost = "vercel" | "onreza" | "other";

export type SiteConfig = {
  id: string;
  name: string;
  /** Public URL used for health checks */
  url: string;
  host: SiteHost;
  /** Optional path that must return 2xx (defaults to /) */
  healthPath?: string;
};

export type SiteStatus = "up" | "down" | "unknown";

export type SiteCheckResult = {
  siteId: string;
  status: SiteStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
  url: string;
};

export type ReportedError = {
  id: string;
  siteId: string;
  message: string;
  stack?: string;
  url?: string;
  source: "client" | "server" | "unknown";
  meta?: Record<string, unknown>;
  receivedAt: string;
};

export type AlertKind = "down" | "up" | "error";
