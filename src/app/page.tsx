import { getAllSiteStatuses, getCronLastRun, listErrors } from "@/lib/redis";
import { getSites } from "@/lib/sites";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sites = getSites();
  let statuses: Awaited<ReturnType<typeof getAllSiteStatuses>> = {};
  let errors: Awaited<ReturnType<typeof listErrors>> = [];
  let lastCron: Awaited<ReturnType<typeof getCronLastRun>> = null;
  let storeError: string | null = null;

  try {
    statuses = await getAllSiteStatuses(sites.map((s) => s.id));
    errors = await listErrors(15);
    lastCron = await getCronLastRun();
  } catch (err) {
    storeError = err instanceof Error ? err.message : String(err);
    console.error("[bigbrother] homepage redis failed", err);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Big Brother</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Total control: HTTP + scrape + crawl + forms + API + DB. Primary UX
          is Telegram.
        </p>
        <p className="mt-2 font-mono text-[11px] text-zinc-600">
          live · {new Date().toISOString()} ·{" "}
          <a className="underline" href="/api/ping">
            /api/ping
          </a>{" "}
          ·{" "}
          <a className="underline" href="/ok.txt">
            /ok.txt
          </a>
        </p>
        <div className="mt-4 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-300">
          <p className="font-medium text-zinc-100">Регистрация Telegram webhook</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-zinc-400">
            <li>
              Vercel → Settings → Environment Variables → скопируй{" "}
              <code className="text-zinc-200">CRON_SECRET</code> (Production)
            </li>
            <li>
              Открой в браузере (секрет после{" "}
              <code className="text-zinc-200">=</code>, без пробелов):
              <br />
              <code className="break-all text-[11px] text-emerald-400">
                /api/telegram?secret=ТВОЙ_CRON_SECRET&amp;force=1
              </code>
            </li>
            <li>
              В ответе должно быть{" "}
              <code className="text-zinc-200">ensure.action: &quot;set&quot;</code>{" "}
              или <code className="text-zinc-200">already</code>, и{" "}
              <code className="text-zinc-200">webhookUrlSet: true</code>
            </li>
            <li>
              Если снова <code className="text-zinc-200">401 Unauthorized</code> —
              секрет не совпал с Production (пробел / старое значение / Needs
              Attention). Пересохрани CRON_SECRET → Redeploy.
            </li>
            <li>В Telegram боту: /start → /sites → /deep</li>
          </ol>
        </div>
        <div className="mt-4 rounded border border-zinc-800 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-300">
          <p className="font-medium text-zinc-100">Автопроверка (cron)</p>
          <p className="mt-1 text-zinc-400">
            Интервал: каждые <span className="text-zinc-200">5 минут</span> через
            GitHub Actions + раз в сутки Vercel Cron (Hobby не умеет чаще).
          </p>
          <p className="mt-2 font-mono text-[11px] text-zinc-500">
            last cron:{" "}
            {lastCron
              ? `${lastCron.at} · ${lastCron.source} · mode=${lastCron.mode} · checked=${lastCron.checked} · down=${lastCron.down} · alerts=${lastCron.alertsSent}`
              : "ещё не было — добавь GitHub secret CRON_SECRET и дождись schedule / Run workflow"}
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-zinc-400">
            <li>
              GitHub → Settings → Secrets and variables → Actions → New secret{" "}
              <code className="text-zinc-200">CRON_SECRET</code> = тот же, что в
              Vercel Production
            </li>
            <li>
              Actions → <code className="text-zinc-200">Health check cron</code>{" "}
              → Run workflow (проверка сразу)
            </li>
            <li>
              Дальше workflow сам дергает{" "}
              <code className="text-zinc-200">/api/check?mode=deep</code> каждые
              5 мин; алерты уходят в Telegram
            </li>
          </ol>
        </div>
      </header>

      {storeError ? (
        <p className="mb-6 rounded border border-amber-800 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
          Redis unavailable: {storeError}. Site list still shown; statuses may
          be empty. Check UPSTASH_REDIS_REST_* env.
        </p>
      ) : null}

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Sites
        </h2>
        <ul className="space-y-2">
          {sites.map((site) => {
            const st = statuses[site.id];
            const color =
              st?.status === "up"
                ? "bg-emerald-500"
                : st?.status === "degraded"
                  ? "bg-amber-400"
                  : st?.status === "down"
                    ? "bg-red-500"
                    : "bg-zinc-500";
            return (
              <li
                key={site.id}
                className="flex items-start gap-3 border-b border-zinc-800 py-3"
              >
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${color}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{site.name}</span>
                    <span className="text-xs text-zinc-500">{site.id}</span>
                  </div>
                  <a
                    href={site.url}
                    className="break-all text-sm text-zinc-400 underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {site.url}
                  </a>
                  <p className="mt-1 text-xs text-zinc-500">
                    {st
                      ? `${st.status} · HTTP ${st.httpStatus ?? "—"} · ${st.latencyMs ?? "?"}ms · fail ${st.probeSummary?.failed ?? "—"}/warn ${st.probeSummary?.warnings ?? "—"} · ${st.checkedAt}`
                      : "No check yet — /deep in Telegram"}
                  </p>
                  {st?.findings && st.findings.length > 0 ? (
                    <ul className="mt-2 space-y-1 font-mono text-[11px] text-zinc-400">
                      {st.findings.slice(0, 6).map((f, i) => (
                        <li key={`${f.name}-${i}`}>
                          [{f.kind}/{f.severity}] {f.name}: {f.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Recent errors
        </h2>
        {errors.length === 0 ? (
          <p className="text-sm text-zinc-500">No stored errors.</p>
        ) : (
          <ul className="space-y-3">
            {errors.map((e) => (
              <li key={e.id} className="border-b border-zinc-800 pb-3 text-sm">
                <div className="text-zinc-400">
                  [{e.siteId}] {e.source} · {e.receivedAt}
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-zinc-200">
                  {e.message}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
