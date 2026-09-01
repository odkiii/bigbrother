import type { DbProbe, ProbeFinding } from "@/lib/types";
import postgres from "postgres";
import mysql from "mysql2/promise";

export async function runDbProbe(probe: DbProbe): Promise<ProbeFinding[]> {
  const severity = probe.severity ?? "critical";
  const url = process.env[probe.urlEnv];
  if (!url) {
    return [
      {
        ok: true,
        kind: "db",
        name: probe.name,
        severity: "warning",
        message: `Skipped — set env ${probe.urlEnv} on Big Brother to enable DB checks`,
      },
    ];
  }

  const started = Date.now();

  try {
    if (probe.driver === "http") {
      const target = probe.httpPath
        ? new URL(probe.httpPath, url).toString()
        : url;
      const res = await fetch(target, {
        method: "GET",
        cache: "no-store",
        headers: { "User-Agent": "BigBrotherMonitor/2.0 (+db-http)" },
        signal: AbortSignal.timeout(10_000),
      });
      const ok = res.ok;
      return [
        {
          ok,
          kind: "db",
          name: probe.name,
          severity,
          message: ok
            ? `DB HTTP health OK (${res.status})`
            : `DB HTTP health failed (${res.status})`,
          url: target,
          latencyMs: Date.now() - started,
        },
      ];
    }

    if (probe.driver === "postgres") {
      const sql = postgres(url, {
        max: 1,
        idle_timeout: 5,
        connect_timeout: 10,
        ssl: "prefer",
      });
      try {
        const q = probe.query ?? "select 1 as ok";
        const rows = await sql.unsafe(q);
        const min = probe.expectRowsMin ?? 1;
        const ok = Array.isArray(rows) && rows.length >= min;
        return [
          {
            ok,
            kind: "db",
            name: probe.name,
            severity,
            message: ok
              ? `Postgres OK (${rows.length} row(s))`
              : `Postgres query returned ${rows.length} rows, expected >= ${min}`,
            latencyMs: Date.now() - started,
            meta: { query: q },
          },
        ];
      } finally {
        await sql.end({ timeout: 2 });
      }
    }

    if (probe.driver === "mysql") {
      const conn = await mysql.createConnection(url);
      try {
        const q = probe.query ?? "SELECT 1 AS ok";
        const [rows] = await conn.query(q);
        const list = Array.isArray(rows) ? rows : [];
        const min = probe.expectRowsMin ?? 1;
        const ok = list.length >= min;
        return [
          {
            ok,
            kind: "db",
            name: probe.name,
            severity,
            message: ok
              ? `MySQL OK (${list.length} row(s))`
              : `MySQL query returned ${list.length} rows, expected >= ${min}`,
            latencyMs: Date.now() - started,
            meta: { query: q },
          },
        ];
      } finally {
        await conn.end();
      }
    }

    return [
      {
        ok: false,
        kind: "db",
        name: probe.name,
        severity,
        message: `Unknown DB driver`,
      },
    ];
  } catch (err) {
    return [
      {
        ok: false,
        kind: "db",
        name: probe.name,
        severity,
        message: `DB probe failed: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - started,
      },
    ];
  }
}
