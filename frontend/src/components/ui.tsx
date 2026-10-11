"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>{children}</div>;
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong active:opacity-90 disabled:opacity-50 dark:text-[#06201d]",
  secondary: "bg-surface border border-line text-ink hover:bg-surface-2 active:bg-surface-2 disabled:opacity-50",
  ghost: "bg-transparent text-accent hover:bg-accent-soft disabled:opacity-50",
  danger: "bg-danger text-white disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className = "",
  busy = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-colors ${variantClass[variant]} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-ink">
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-11 px-2 font-medium text-accent">
          Retry
        </button>
      )}
    </div>
  );
}

export function DifficultyDots({ level, max = 4 }: { level: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Difficulty ${level} of ${max}`} title={`Difficulty ${level} of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`size-1.5 rounded-full ${i < level ? "bg-accent" : "bg-line"}`} />
      ))}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">{children}</span>;
}

/** Scrollable row of pill choices; use when there are more options than a Segmented control fits. */
export function Chips<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-10 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              active ? "border-accent bg-accent text-white dark:text-[#06201d]" : "border-line bg-surface text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`min-h-10 flex-1 rounded-lg px-2 text-[13px] font-medium transition-colors ${
              active ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </header>
  );
}

export function Collapsible({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 py-3 text-[15px] font-medium select-none">
        {title}
        <svg className="chev size-4 text-muted transition-transform" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="border-t border-line px-4 py-3 text-[15px] leading-relaxed">{children}</div>
    </details>
  );
}

export function BackLink({ href, children = "Home" }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 pr-2 text-[15px] font-medium text-accent">
      <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </Link>
  );
}
