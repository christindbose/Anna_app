"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, messageOf, toast } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { Button, Card, ErrorNote, PageTitle, Skeleton, Tag } from "@/components/ui";

const GRADES = [
  { label: "Again", grade: 1, hint: "Didn't know" },
  { label: "Hard", grade: 3, hint: "Barely" },
  { label: "Good", grade: 4, hint: "Knew it" },
  { label: "Easy", grade: 5, hint: "Instant" },
];

export default function ReviewPage() {
  const due = useApi(() => api.reviewsDue(), "reviews");
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState<number | null>(null);
  const [done, setDone] = useState(0);

  useEffect(() => {
    setIndex(0);
    setRevealed(false);
    setDone(0);
  }, [due.data]);

  const items = due.data ?? [];
  const item = items[index];

  async function grade(g: number) {
    if (!item || grading !== null) return;
    setGrading(g);
    try {
      await api.grade(item.id, g);
      setDone((d) => d + 1);
      setIndex((i) => i + 1);
      setRevealed(false);
    } catch (e) {
      toast(messageOf(e));
    } finally {
      setGrading(null);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4" style={{ paddingTop: "calc(1.25rem + var(--sa-top))" }}>
      <PageTitle sub="Short questions from concepts you missed, spaced over time.">Review</PageTitle>

      {due.loading ? (
        <Skeleton className="h-64" />
      ) : due.error ? (
        <ErrorNote message={due.error} onRetry={due.reload} />
      ) : due.unauthorized ? (
        <p className="text-sm text-muted">Enter the password to load your reviews.</p>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing due" body="Finish a case and any concept you miss will show up here as a question." />
      ) : !item ? (
        <EmptyState title="All done for now" body={`${done} card${done === 1 ? "" : "s"} reviewed. Come back when the next ones are due.`} />
      ) : (
        <>
          <p className="mb-2 text-xs font-medium text-muted">
            {index + 1} of {items.length}
          </p>
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Tag>{item.concept}</Tag>
              <span className="text-[11px] text-muted">from “{item.case_title}”</span>
            </div>
            <p className="mt-3 text-[17px] leading-relaxed">{item.question}</p>

            {revealed ? (
              <div className="mt-4 rounded-xl bg-accent-soft/60 p-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-accent-strong">Answer</p>
                <p className="text-[15px] leading-relaxed whitespace-pre-line">{item.answer}</p>
              </div>
            ) : (
              <Button variant="secondary" className="mt-4 w-full" onClick={() => setRevealed(true)}>
                Show answer
              </Button>
            )}
          </Card>

          {revealed && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g.grade}
                  type="button"
                  disabled={grading !== null}
                  onClick={() => grade(g.grade)}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-xl border text-[15px] font-medium disabled:opacity-50 ${
                    g.grade === 1
                      ? "border-danger/40 text-danger"
                      : g.grade === 5
                        ? "border-accent/40 bg-accent-soft/60 text-accent-strong"
                        : "border-line bg-surface"
                  }`}
                >
                  {g.label}
                  <span className="text-[10px] font-normal text-muted">{g.hint}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="text-center">
      <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-accent-soft text-accent-strong">
        <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
      <Link href="/" className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 font-medium text-white dark:text-[#06201d]">
        Start a case
      </Link>
    </Card>
  );
}
