"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CATEGORIES,
  MODE_LABEL,
  api,
  messageOf,
  streamRespond,
  toast,
  type RubricResultView,
  type SessionResult,
  type SessionView,
  type Stage,
  type Turn,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { BackLink, Button, Card, Collapsible, ErrorNote, Skeleton, Spinner } from "@/components/ui";

export default function CasePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const loaded = useApi(() => api.session(id), `session:${id}`);

  // Local, mutable copy of the session once loaded.
  const [session, setSession] = useState<SessionView | null>(null);
  useEffect(() => {
    if (loaded.data) setSession(loaded.data);
  }, [loaded.data]);

  if (loaded.loading && !session) return <LoadingCase />;
  if (loaded.error && !session) {
    return (
      <main className="mx-auto max-w-lg px-4" style={{ paddingTop: "calc(0.5rem + var(--sa-top))" }}>
        <BackLink href="/" />
        <div className="mt-4">
          <ErrorNote message={loaded.error} onRetry={loaded.reload} />
        </div>
      </main>
    );
  }
  if (!session) {
    return (
      <main className="mx-auto max-w-lg px-4" style={{ paddingTop: "calc(0.5rem + var(--sa-top))" }}>
        <BackLink href="/" />
        <p className="mt-4 text-sm text-muted">Enter the password to open this case.</p>
      </main>
    );
  }
  return <Player session={session} setSession={setSession} />;
}

function LoadingCase() {
  return (
    <main className="mx-auto max-w-lg px-4" style={{ paddingTop: "calc(0.5rem + var(--sa-top))" }}>
      <Skeleton className="h-11 w-24" />
      <Skeleton className="mt-3 h-7 w-3/4" />
      <Skeleton className="mt-2 h-2 w-full" />
      <Skeleton className="mt-6 h-32" />
      <Skeleton className="mt-3 h-24" />
    </main>
  );
}

/* ---------------- player ---------------- */

type ThreadItem =
  | { kind: "presentation"; text: string }
  | { kind: "reveal"; stage: Stage; index: number }
  | { kind: "turn"; turn: Turn; key: string };

function Player({ session, setSession }: { session: SessionView; setSession: (s: SessionView) => void }) {
  const finished = session.status === "finished";
  const current = session.stage_index;
  const isLast = current >= session.case.n_stages - 1;
  const currentStage = session.stages[current];
  const hasLearnerTurnNow = session.turns.some((t) => t.role === "learner" && t.stage_index === current);

  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const debriefRef = useRef<HTMLElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const thread = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = [{ kind: "presentation", text: session.case.presentation }];
    session.stages.forEach((stage, i) => {
      items.push({ kind: "reveal", stage, index: i });
      session.turns.forEach((turn, j) => {
        if (turn.stage_index === i) items.push({ kind: "turn", turn, key: `${i}-${j}` });
      });
    });
    return items;
  }, [session]);

  // Keep the newest content in view.
  const threadLen = thread.length;
  const streamLen = streaming?.length ?? 0;
  useEffect(() => {
    if (finished) {
      debriefRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    } else {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: streamLen ? "auto" : "smooth" });
    }
  }, [threadLen, streamLen, finished]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);
  useEffect(autoGrow, [draft, autoGrow]);

  function insertTest(test: string) {
    const line = `I'd like to order ${test}.`;
    setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, "")} ${line}` : line));
    textareaRef.current?.focus();
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || streaming !== null || finished) return;
    setDraft("");
    const learnerTurn: Turn = { role: "learner", stage_index: current, content: text };
    const withLearner: SessionView = { ...session, turns: [...session.turns, learnerTurn] };
    setSession(withLearner);
    setStreaming("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let reply = "";
    try {
      for await (const chunk of streamRespond(session.id, text, ctrl.signal)) {
        reply += chunk;
        setStreaming(reply);
      }
      const attending: Turn = { role: "attending", stage_index: current, content: reply.trim() };
      setSession({ ...withLearner, turns: [...withLearner.turns, attending] });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        toast(messageOf(err));
        if (!reply) {
          // Learner turn is stored server-side before streaming begins only if the request got through;
          // on a transport error restore the draft so nothing is lost.
          setDraft(text);
          setSession(session);
        } else {
          setSession({ ...withLearner, turns: [...withLearner.turns, { role: "attending", stage_index: current, content: reply.trim() }] });
        }
      }
    } finally {
      setStreaming(null);
      abortRef.current = null;
    }
  }

  async function advance() {
    if (advancing || streaming !== null) return;
    setAdvancing(true);
    try {
      const r = await api.advance(session.id);
      if (r.done) {
        setSheetOpen(true);
      } else {
        setSession({ ...session, stage_index: r.stage_index, stages: [...session.stages, r.stage] });
      }
    } catch (err) {
      toast(messageOf(err));
    } finally {
      setAdvancing(false);
    }
  }

  const canAct = hasLearnerTurnNow && streaming === null && !finished;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      {/* Header */}
      <header className="sticky z-20 border-b border-line bg-bg/95 px-4 pb-2 backdrop-blur" style={{ top: 0, paddingTop: "var(--sa-top)" }}>
        <div className="flex items-center justify-between">
          <BackLink href="/" />
          <span className="text-xs text-muted">{MODE_LABEL[session.mode] ?? session.mode}</span>
        </div>
        <h1 className="text-[17px] font-semibold leading-snug">{session.case.title}</h1>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {Array.from({ length: session.case.n_stages }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= current ? "bg-accent" : "bg-line"}`} />
            ))}
          </div>
          <span className="text-xs text-muted">
            {finished ? "Done" : `Stage ${current + 1} of ${session.case.n_stages}`}
          </span>
        </div>
      </header>

      {/* Thread */}
      <main className="flex-1 space-y-3 px-4 py-4">
        {thread.map((item, i) => {
          if (item.kind === "presentation") {
            return (
              <Card key="presentation">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-accent">Presentation</p>
                <p className="text-[15px] leading-relaxed whitespace-pre-line">{item.text}</p>
              </Card>
            );
          }
          if (item.kind === "reveal") {
            return (
              <Card key={`reveal-${item.index}`} className="border-accent/30">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-accent">
                  {item.stage.label} <span className="text-muted">· {item.index + 1}/{session.case.n_stages}</span>
                </p>
                <p className="text-[15px] leading-relaxed whitespace-pre-line">{item.stage.text}</p>
                {item.stage.prompt && <p className="mt-3 text-[15px] italic leading-relaxed text-muted">{item.stage.prompt}</p>}
              </Card>
            );
          }
          return <Bubble key={item.key ?? i} turn={item.turn} />;
        })}
        {streaming !== null && <Bubble turn={{ role: "attending", stage_index: current, content: streaming }} streaming />}

        {canAct && (
          <div className="flex justify-center pt-1">
            {isLast ? (
              <Button onClick={() => setSheetOpen(true)} className="w-full">
                Commit to a diagnosis
              </Button>
            ) : (
              <Button variant="secondary" busy={advancing} onClick={advance} className="w-full">
                Reveal next stage
              </Button>
            )}
          </div>
        )}

        {finished && session.result && <Debrief ref={debriefRef} result={session.result} />}
        <div ref={bottomRef} className="h-px" />
      </main>

      {/* Composer */}
      {!finished ? (
        <form
          onSubmit={send}
          className="sticky bottom-0 z-20 border-t border-line bg-surface"
          style={{ paddingBottom: "var(--sa-bottom)" }}
        >
          {currentStage?.available_tests?.length ? (
            <div className="flex gap-2 overflow-x-auto px-4 pt-2.5 pb-1 [scrollbar-width:none]">
              {currentStage.available_tests.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => insertTest(t)}
                  className="min-h-9 shrink-0 rounded-full border border-accent/30 bg-accent-soft px-3 text-[13px] font-medium text-accent-strong active:opacity-80"
                >
                  + {t}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-2 px-3 py-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
              }}
              rows={1}
              placeholder={streaming !== null ? "Your attending is replying…" : "Your differential, your next test, and why…"}
              disabled={streaming !== null}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2.5 text-[16px] leading-snug outline-none focus:border-accent disabled:opacity-60"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim() || streaming !== null}
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-white disabled:opacity-40 dark:text-[#06201d]"
            >
              {streaming !== null ? (
                <Spinner />
              ) : (
                <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path d="M3 10h13M11 5l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        </form>
      ) : (
        <div className="sticky bottom-0 z-20 border-t border-line bg-surface px-4 py-3" style={{ paddingBottom: "calc(0.75rem + var(--sa-bottom))" }}>
          <div className="flex gap-2">
            <Link href="/" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-accent text-[15px] font-medium text-white dark:text-[#06201d]">
              Another case
            </Link>
            <Link href="/review" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line bg-surface text-[15px] font-medium">
              Review queue
            </Link>
          </div>
        </div>
      )}

      {sheetOpen && (
        <CommitSheet
          onClose={() => setSheetOpen(false)}
          onFinished={(s) => {
            setSheetOpen(false);
            setSession(s);
          }}
          sessionId={session.id}
        />
      )}
    </div>
  );
}

function Bubble({ turn, streaming = false }: { turn: Turn; streaming?: boolean }) {
  const learner = turn.role === "learner";
  return (
    <div className={`flex ${learner ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
          learner ? "rounded-br-md bg-accent text-white dark:text-[#06201d]" : "rounded-bl-md border border-line bg-surface"
        }`}
      >
        {!learner && <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">Attending</p>}
        {turn.content}
        {streaming && (
          <span className="ml-1 inline-flex gap-0.5 align-middle" aria-label="Attending is typing">
            <span className="typing-dot inline-block size-1.5 rounded-full bg-muted" />
            <span className="typing-dot inline-block size-1.5 rounded-full bg-muted" />
            <span className="typing-dot inline-block size-1.5 rounded-full bg-muted" />
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- commit sheet ---------------- */

function CommitSheet({ sessionId, onClose, onFinished }: { sessionId: string; onClose: () => void; onFinished: (s: SessionView) => void }) {
  const [dx, setDx] = useState("");
  const [mgmt, setMgmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dx.trim() || !mgmt.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await api.finish(sessionId, { diagnosis: dx.trim(), management: mgmt.trim() });
      onFinished(s);
    } catch (e2) {
      setErr(messageOf(e2));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-t-3xl border border-line bg-surface p-5 shadow-xl sm:rounded-3xl"
        style={{ paddingBottom: "calc(1.25rem + var(--sa-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <h2 className="text-lg font-semibold">Commit to a diagnosis</h2>
        <p className="mt-1 text-sm text-muted">Name your working diagnosis and the first things you would do.</p>

        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Final diagnosis</span>
          <input
            value={dx}
            onChange={(e) => setDx(e.target.value)}
            disabled={busy}
            autoFocus
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent"
            placeholder="e.g. SIADH from small cell lung cancer"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">First management steps</span>
          <textarea
            value={mgmt}
            onChange={(e) => setMgmt(e.target.value)}
            disabled={busy}
            rows={3}
            className="mt-1 w-full resize-none rounded-xl border border-line bg-bg px-3 py-2.5 text-[16px] leading-snug outline-none focus:border-accent"
            placeholder="What you'd order, start, stop, or escalate."
          />
        </label>

        {err && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {err}
          </p>
        )}
        {busy && <p className="mt-3 text-sm text-muted">Scoring and writing your debrief. This takes a few seconds.</p>}

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1">
            Not yet
          </Button>
          <Button type="submit" busy={busy} disabled={!dx.trim() || !mgmt.trim()} className="flex-1">
            Submit
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- debrief ---------------- */

function Debrief({ result, ref }: { result: SessionResult; ref: React.Ref<HTMLElement> }) {
  const score = result.score ?? 0;
  const max = result.max_score ?? 0;
  const pct = max > 0 ? Math.round((100 * score) / max) : 0;
  const paragraphs = (result.debrief ?? "").split(/\n\s*\n|\n(?=\S)/).map((p) => p.trim()).filter(Boolean);
  const grouped: { category: string; items: RubricResultView[] }[] = CATEGORIES.map((c) => ({
    category: c,
    items: result.rubric.filter((r) => r.category === c),
  })).filter((g) => g.items.length);
  const other = result.rubric.filter((r) => !(CATEGORIES as string[]).includes(r.category));
  if (other.length) grouped.push({ category: "other", items: other });

  return (
    <section ref={ref} className="scroll-mt-28 space-y-3 pt-2" aria-label="Debrief">
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-line" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Debrief</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <Card>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Score</p>
            <p className="text-4xl font-semibold tracking-tight">
              {score}
              <span className="text-xl text-muted"> / {max}</span>
            </p>
          </div>
          <p className="text-lg font-medium text-accent">{pct}%</p>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        {result.final_diagnosis && (
          <p className="mt-3 text-sm text-muted">
            You committed to <span className="font-medium text-ink">{result.final_diagnosis}</span>.
          </p>
        )}
      </Card>

      {paragraphs.length > 0 && (
        <Card>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">From your attending</p>
          <div className="space-y-3 text-[15px] leading-relaxed">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-accent">Rubric</p>
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.category}>
              <p className="mb-1 text-[13px] font-semibold capitalize">{g.category}</p>
              <ul className="space-y-1.5">
                {g.items.map((r) => (
                  <li key={r.id} className="flex items-start gap-2 text-[15px] leading-snug">
                    {r.hit ? (
                      <svg className="mt-0.5 size-5 shrink-0 text-ok" viewBox="0 0 20 20" fill="none" aria-label="Hit">
                        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M6 10.5l2.5 2.5L14 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg className="mt-0.5 size-5 shrink-0 text-danger" viewBox="0 0 20 20" fill="none" aria-label="Missed">
                        <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    )}
                    <span className={r.hit ? "" : "text-ink"}>
                      {r.description}
                      <span className="ml-1 text-xs text-muted">
                        {r.hit ? r.weight : 0}/{r.weight}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Collapsible title="Actual diagnosis" defaultOpen>
        <p className="font-medium">{result.diagnosis}</p>
        {result.final_management && (
          <p className="mt-2 text-sm text-muted">
            Your plan: <span className="text-ink">{result.final_management}</span>
          </p>
        )}
      </Collapsible>

      {result.key_clues.length > 0 && (
        <Collapsible title="Key clues">
          <ul className="list-disc space-y-1 pl-5">
            {result.key_clues.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Collapsible>
      )}

      {result.distractors.length > 0 && (
        <Collapsible title="Distractors">
          <ul className="space-y-2">
            {result.distractors.map((d, i) => (
              <li key={i}>
                <p className="font-medium">{d.name}</p>
                <p className="text-sm text-muted">{d.why_not}</p>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {result.management_summary && (
        <Collapsible title="Management">
          <p className="whitespace-pre-line">{result.management_summary}</p>
        </Collapsible>
      )}

      {result.teaching_points.length > 0 && (
        <Collapsible title="Teaching points">
          <ul className="list-disc space-y-1 pl-5">
            {result.teaching_points.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Collapsible>
      )}

      {result.references.length > 0 && (
        <Collapsible title="References">
          <ul className="space-y-1 text-sm text-muted">
            {result.references.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Collapsible>
      )}

      <p className="pt-2 text-center text-xs text-muted">Educational simulation with fictional patients. Not medical advice.</p>
    </section>
  );
}
