"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, messageOf, toast, type Track } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Button, Card, DifficultyDots, ErrorNote, Segmented, Skeleton, Tag } from "@/components/ui";

type TrackChoice = "all" | Track;

export default function HomePage() {
  const router = useRouter();
  const health = useApi(() => api.health(), "health");
  const progress = useApi(() => api.progress(), "progress");
  const cases = useApi(() => api.cases(), "cases");
  const attendings = useApi(() => api.attendings(), "attendings");

  const [track, setTrack] = useState<TrackChoice>("all");
  const [attendingId, setAttendingId] = useState<string>("mentor");
  const [starting, setStarting] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("");
  useEffect(() => setGreeting(greetingLine()), []);

  // Remember the last choices on this phone.
  useEffect(() => {
    try {
      const t = window.localStorage.getItem("anna_track") as TrackChoice | null;
      const m = window.localStorage.getItem("anna_attending");
      if (t === "all" || t === "general-im" || t === "rheum") setTrack(t);
      if (m) setAttendingId(m);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("anna_track", track);
      window.localStorage.setItem("anna_attending", attendingId);
    } catch {
      /* ignore */
    }
  }, [track, attendingId]);

  async function start(caseId?: string) {
    setStarting(caseId ?? "random");
    try {
      const s = await api.startSession({ case_id: caseId ?? null, attending_id: attendingId, track: track === "all" ? null : track });
      router.push(`/case/${s.id}`);
    } catch (e) {
      toast(messageOf(e));
      setStarting(null);
    }
  }

  const name = health.data?.learner ?? "Anna";
  const visibleCases = useMemo(
    () => (cases.data ?? []).filter((c) => track === "all" || c.track === track),
    [cases.data, track],
  );
  const due = progress.data?.reviews_due ?? 0;

  return (
    <main className="mx-auto max-w-lg px-4" style={{ paddingTop: "calc(1.25rem + var(--sa-top))" }}>
      <header className="mb-5">
        {health.loading ? (
          <Skeleton className="h-8 w-40" />
        ) : (
          <h1 className="text-[28px] font-semibold tracking-tight">Hi {name}</h1>
        )}
        <p className="mt-1 min-h-5 text-[15px] text-muted">{greeting}</p>
      </header>

      {/* Reviews due */}
      {progress.loading ? (
        <Skeleton className="mb-4 h-[72px]" />
      ) : progress.error ? (
        <div className="mb-4">
          <ErrorNote message={progress.error} onRetry={progress.reload} />
        </div>
      ) : (
        <Link href="/review" className="mb-4 block">
          <Card className="flex items-center justify-between gap-3 active:bg-surface-2">
            <div>
              <p className="text-[15px] font-medium">{due === 0 ? "No reviews due" : `${due} review${due === 1 ? "" : "s"} due`}</p>
              <p className="text-sm text-muted">{due === 0 ? "You're caught up on weak spots." : "Short questions from concepts you missed."}</p>
            </div>
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-full text-base font-semibold ${
                due > 0 ? "bg-accent-soft text-accent-strong" : "bg-surface-2 text-muted"
              }`}
            >
              {due}
            </span>
          </Card>
        </Link>
      )}

      {/* Start a case */}
      <Card className="mb-6">
        <h2 className="text-lg font-semibold">Start a case</h2>
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Track</p>
            <Segmented
              label="Track"
              value={track}
              onChange={setTrack}
              options={[
                { value: "all", label: "All" },
                { value: "general-im", label: "General IM" },
                { value: "rheum", label: "Rheum" },
              ]}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">Attending</p>
            {attendings.data ? (
              <div role="radiogroup" aria-label="Attending" className="space-y-1.5">
                {attendings.data.map((a) => {
                  const active = a.id === attendingId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAttendingId(a.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        active ? "border-accent bg-accent/5" : "border-line bg-surface-2/60"
                      }`}
                    >
                      <span className="text-2xl leading-none" aria-hidden>
                        {a.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[15px] font-medium">{a.name}</span>
                          <DifficultyDots level={a.difficulty} />
                        </span>
                        <span className="block text-xs font-medium text-accent">{a.title}</span>
                        <span className="block text-xs text-muted">{a.tagline}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Skeleton className="h-40" />
            )}
          </div>
          <Button className="w-full" busy={starting === "random"} disabled={starting !== null} onClick={() => start()}>
            Start a random case
          </Button>
        </div>
      </Card>

      {/* Case list */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Case library</h2>
          {cases.data && (
            <span className="text-sm text-muted">
              {visibleCases.filter((c) => c.completed).length}/{visibleCases.length} done
            </span>
          )}
        </div>
        {cases.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
            <Skeleton className="h-[76px]" />
          </div>
        ) : cases.error ? (
          <ErrorNote message={cases.error} onRetry={cases.reload} />
        ) : cases.unauthorized ? (
          <p className="text-sm text-muted">Enter the password to load cases.</p>
        ) : visibleCases.length === 0 ? (
          <Card className="text-sm text-muted">No cases in this track yet.</Card>
        ) : (
          <ul className="space-y-2">
            {visibleCases.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={starting !== null}
                  onClick={() => start(c.id)}
                  className="w-full rounded-2xl border border-line bg-surface p-4 text-left transition-colors active:bg-surface-2 disabled:opacity-60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium leading-snug">{c.title}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <DifficultyDots level={c.difficulty} />
                        <span className="text-[11px] text-muted">{c.track === "rheum" ? "Rheum" : "General IM"}</span>
                        {!c.reviewed && <Tag>draft</Tag>}
                        {c.tags.map((t) => (
                          <Tag key={t}>{t}</Tag>
                        ))}
                      </div>
                    </div>
                    <span className="mt-0.5 shrink-0" aria-label={c.completed ? "Completed" : undefined}>
                      {starting === c.id ? (
                        <span className="inline-block size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                      ) : c.completed ? (
                        <svg className="size-5 text-ok" viewBox="0 0 20 20" fill="none" aria-hidden>
                          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M6 10.5l2.5 2.5L14 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg className="size-5 text-line" viewBox="0 0 20 20" fill="none" aria-hidden>
                          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                      )}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 pb-2 text-center text-xs text-muted">Educational simulation with fictional patients. Not medical advice.</footer>
    </main>
  );
}

function greetingLine(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night on call? One case at a time.";
  if (h < 12) return "Ready to round?";
  if (h < 18) return "A case fits in a coffee break.";
  return "One case before you log off.";
}
