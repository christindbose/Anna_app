"use client";

import Link from "next/link";
import { useMemo } from "react";
import { CATEGORIES, MODE_LABEL, api, formatDate } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Card, ErrorNote, PageTitle, Skeleton } from "@/components/ui";

export default function ProgressPage() {
  const progress = useApi(() => api.progress(), "progress");
  const cases = useApi(() => api.cases(), "cases");

  const titles = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of cases.data ?? []) m.set(c.id, c.title);
    return m;
  }, [cases.data]);

  const p = progress.data;
  const weak = (p?.weak_concepts ?? []).filter((w) => w.miss_rate > 0);

  return (
    <main className="mx-auto max-w-lg px-4" style={{ paddingTop: "calc(1.25rem + var(--sa-top))" }}>
      <PageTitle sub="Where your reasoning is strong and where it drifts.">Progress</PageTitle>

      {progress.loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-44" />
          <Skeleton className="h-36" />
        </div>
      ) : progress.error ? (
        <ErrorNote message={progress.error} onRetry={progress.reload} />
      ) : progress.unauthorized || !p ? (
        <p className="text-sm text-muted">Enter the password to load your progress.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Cases completed</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight">{p.cases_completed}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Overall</p>
              <p className="mt-1 text-3xl font-semibold tracking-tight">
                {p.overall_pct === null ? <span className="text-muted">—</span> : `${p.overall_pct}%`}
              </p>
            </Card>
          </div>

          <Card>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-accent">By category</p>
            <ul className="space-y-3">
              {CATEGORIES.map((c) => {
                const v = p.by_category[c] ?? { hit: 0, total: 0 };
                const pct = v.total > 0 ? Math.round((100 * v.hit) / v.total) : 0;
                return (
                  <li key={c}>
                    <div className="mb-1 flex items-baseline justify-between text-[15px]">
                      <span className="font-medium capitalize">{c}</span>
                      <span className="text-sm text-muted">
                        {v.hit}/{v.total}
                        {v.total > 0 && <span className="ml-1.5 text-ink">{pct}%</span>}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={c} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            {p.cases_completed === 0 && <p className="mt-3 text-sm text-muted">Finish your first case to see category scores.</p>}
          </Card>

          <Card>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">Weak concepts</p>
            {weak.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet. Concepts you miss will show up here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {weak.map((w) => {
                  const miss = Math.round(100 * w.miss_rate);
                  return (
                    <li key={w.concept} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-[15px] font-medium leading-snug">{w.concept}</p>
                        <p className="text-xs text-muted">
                          missed {w.total - w.hit} of {w.total}
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${miss >= 50 ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted"}`}>
                        {miss}% miss
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">Recent sessions</p>
            {p.recent.length === 0 ? (
              <p className="text-sm text-muted">No finished cases yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {p.recent.map((r) => {
                  const pct = r.max_score ? Math.round((100 * (r.score ?? 0)) / r.max_score) : null;
                  return (
                    <li key={r.session_id}>
                      <Link href={`/case/${r.session_id}`} className="-mx-1 flex min-h-12 items-center justify-between gap-3 rounded-lg px-1 py-2 active:bg-surface-2">
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-[15px] font-medium leading-snug">{titles.get(r.case_id) ?? r.case_id}</p>
                          <p className="text-xs text-muted">
                            {formatDate(r.finished_at)}
                            {r.mode === "challenge" ? ` · ${MODE_LABEL.challenge}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-sm text-muted">
                            {r.score ?? 0}/{r.max_score ?? 0}
                          </span>
                          {pct !== null && <span className="text-sm font-semibold text-accent">{pct}%</span>}
                          <svg className="size-4 text-muted" viewBox="0 0 20 20" fill="none" aria-hidden>
                            <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}
    </main>
  );
}
