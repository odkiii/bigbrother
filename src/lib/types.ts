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

export type SiteStatus = "up" | "down" | "degraded" | "unknown";

export type ProbeKind =
  | "http"
  | "page"
  | "crawl"
  | "asset"
  | "form"
  | "api"
  | "db"
  | "html_error";

export type ProbeSeverity = "critical" | "warning";

export type ProbeFinding = {
  ok: boolean;
  kind: ProbeKind;
  name: string;
  severity: ProbeSeverity;
  message: string;
  url?: string;
  latencyMs?: number;
  meta?: Record<string, unknown>;
};

export type SiteCheckResult = {
  siteId: string;
  status: SiteStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
  url: string;
  /** Deep probe summary */
  probeSummary?: {
    total: number;
    failed: number;
    warnings: number;
  };
  findings?: ProbeFinding[];
};

export type ReportedError = {
  id: string;
  siteId: string;
  message: string;
  stack?: string;
  url?: string;
  source: "client" | "server" | "probe" | "unknown";
  meta?: Record<string, unknown>;
  receivedAt: string;
};

export type AlertKind = "down" | "up" | "degraded" | "error";

/** ---- Probe config (JSON per site in /probes) ---- */

export type PageAssert = {
  /** CSS selector that must exist */
  selector?: string;
  /** Text that must appear somewhere in HTML */
  textIncludes?: string;
  /** Text that must NOT appear */
  textExcludes?: string;
  /** Title must match (substring or regex /.../) */
  titleIncludes?: string;
};

export type PageProbe = {
  path: string;
  name?: string;
  assert?: PageAssert[];
  /** Also scan HTML for PHP/Next/stack error signatures */
  scanErrors?: boolean;
  /** Check linked CSS/JS within budgets (weak-net heuristic) */
  checkAssets?: boolean;
  maxAssetBytes?: number;
  maxAssetMs?: number;
  maxHtmlBytes?: number;
  maxTtfbMs?: number;
};

export type CrawlProbe = {
  /** Start path, default / */
  startPath?: string;
  /** Max internal pages to visit */
  maxPages?: number;
  /** Same-origin only */
  sameOrigin?: boolean;
  scanErrors?: boolean;
  checkAssets?: boolean;
  maxAssetBytes?: number;
  maxAssetMs?: number;
};

export type FormProbe = {
  name: string;
  /** Page that contains the form */
  pagePath: string;
  /** CSS selector for the form (default first form) */
  formSelector?: string;
  /** Field name -> value. Use "{{timestamp}}" placeholder */
  fields: Record<string, string>;
  /**
   * How to submit:
   * - auto: POST to form action with fields (+ hidden inputs)
   * - discover: only verify form exists and action URL is reachable (GET/HEAD)
   */
  mode?: "auto" | "discover";
  /** Expected HTTP statuses (default 200-399) */
  expectStatus?: number[];
  /** Response body must include */
  expectTextIncludes?: string;
  /** Response body must NOT include */
  expectTextExcludes?: string;
  /** Mark as warning instead of critical (e.g. honeypot forms) */
  severity?: ProbeSeverity;
};

export type ApiProbe = {
  name: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "HEAD";
  headers?: Record<string, string>;
  /** Header values that start with env:VAR pull from process.env */
  body?: string | Record<string, unknown>;
  expectStatus?: number[];
  expectJsonPath?: string;
  expectTextIncludes?: string;
  maxMs?: number;
  severity?: ProbeSeverity;
};

export type DbProbe = {
  name: string;
  /** postgres | mysql | http */
  driver: "postgres" | "mysql" | "http";
  /**
   * Env var name holding connection string / URL
   * e.g. "DOCTOR_DATABASE_URL"
   */
  urlEnv: string;
  /** SQL for postgres/mysql (default SELECT 1) */
  query?: string;
  /** For http driver: GET this path relative to urlEnv base, or absolute */
  httpPath?: string;
  expectRowsMin?: number;
  severity?: ProbeSeverity;
};

export type SiteProbeConfig = {
  siteId: string;
  /** Always run basic HTTP + homepage error scan even if empty */
  pages?: PageProbe[];
  crawl?: CrawlProbe;
  forms?: FormProbe[];
  apis?: ApiProbe[];
  databases?: DbProbe[];
  /** Extra hardcoded asset URLs to verify */
  assets?: Array<{
    path: string;
    maxBytes?: number;
    maxMs?: number;
    name?: string;
  }>;
};
