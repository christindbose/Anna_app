"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AUTH_EVENT, PW_KEY, SERVER_EVENT, STATIC_BUILD, TOAST_EVENT, UNAUTHORIZED_EVENT, UNREACHABLE_EVENT, UnauthorizedError, api, getServerBase, messageOf, setPassword, setServerBase } from "@/lib/api";

const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/review", label: "Review", icon: ReviewIcon },
  { href: "/progress", label: "Progress", icon: ProgressIcon },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inCase = pathname?.startsWith("/case");
  return (
    <>
      <div className={inCase ? "" : "pb-[calc(4.5rem+var(--sa-bottom))]"}>{children}</div>
      {!inCase && <TabBar pathname={pathname ?? "/"} />}
      <PasswordGate />
      <ServerGate />
      <Toaster />
    </>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "var(--sa-bottom)", paddingLeft: "var(--sa-left)", paddingRight: "var(--sa-right)" }}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <t.icon active={active} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PasswordGate() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => {
      setOpen(true);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pw.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      try {
        window.localStorage.setItem(PW_KEY, pw.trim());
      } catch {
        /* private mode */
      }
      await api.authCheck(true);
      setOpen(false);
      setPw("");
      window.dispatchEvent(new Event(AUTH_EVENT));
    } catch (e2) {
      setErr(e2 instanceof UnauthorizedError ? "That password didn't work." : messageOf(e2));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" style={{ paddingBottom: "calc(1rem + var(--sa-bottom))" }}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Password</h2>
        <p className="mt-1 text-sm text-muted">This app is private. Enter the shared password to continue.</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="mt-4 min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent"
          placeholder="Password"
        />
        {err && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !pw.trim()}
          className="mt-4 min-h-11 w-full rounded-xl bg-accent font-medium text-white disabled:opacity-50 dark:text-[#06201d]"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}

function ServerGate() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const show = () => {
      setUrl(getServerBase());
      setErr(null);
      setOpen(true);
    };
    // In the static build the backend address is the first thing to fix when fetches fail.
    const onUnreachable = () => {
      if (STATIC_BUILD) show();
    };
    window.addEventListener(SERVER_EVENT, show);
    window.addEventListener(UNREACHABLE_EVENT, onUnreachable);
    if (STATIC_BUILD && !getServerBase()) show();
    return () => {
      window.removeEventListener(SERVER_EVENT, show);
      window.removeEventListener(UNREACHABLE_EVENT, onUnreachable);
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = url.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//.test(v)) {
      setErr("Start the address with https:// (or http:// on a local network).");
      return;
    }
    if (v.startsWith("http://") && window.location.protocol === "https:") {
      setErr("This page is https, so the server address must be https too. A Cloudflare tunnel gives you one.");
      return;
    }
    setBusy(true);
    setErr(null);
    setServerBase(v);
    if (pw.trim()) setPassword(pw.trim());
    try {
      const h = await api.health();
      setOpen(false);
      setPw("");
      window.dispatchEvent(new Event(AUTH_EVENT));
      window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: `Connected · ${h.llm_model.split("/").pop()}` }));
    } catch (e2) {
      setErr(e2 instanceof UnauthorizedError ? "Connected, but the password is wrong." : messageOf(e2));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" style={{ paddingBottom: "calc(1rem + var(--sa-bottom))" }}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold">Server</h2>
        <p className="mt-1 text-sm text-muted">
          {STATIC_BUILD
            ? "This page is hosted on GitHub; the AI attending runs on a private GPU server. Paste its address (the tunnel link) and the shared password."
            : "Where the AI attending runs. Leave blank to use this site's own backend."}
        </p>
        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-muted" htmlFor="server-url">
          Server address
        </label>
        <input
          id="server-url"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent"
          placeholder="https://something.trycloudflare.com"
        />
        <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-muted" htmlFor="server-pw">
          Password
        </label>
        <input
          id="server-pw"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] outline-none focus:border-accent"
          placeholder="Leave blank to keep the saved one"
        />
        {err && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {err}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 flex-1 rounded-xl border border-line bg-surface font-medium">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-xl bg-accent font-medium text-white disabled:opacity-50 dark:text-[#06201d]">
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setMsg(detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 4000);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      if (timer) clearTimeout(timer);
    };
  }, []);
  if (!msg) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{ top: "calc(0.75rem + var(--sa-top))" }}
    >
      <div className="pointer-events-auto max-w-md rounded-xl bg-ink px-4 py-3 text-sm text-bg shadow-lg">{msg}</div>
    </div>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
    </svg>
  );
}
function ReviewIcon({ active }: { active: boolean }) {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M7 10h10M7 14h6" strokeLinecap="round" className={active ? "stroke-surface" : ""} />
    </svg>
  );
}
function ProgressIcon({ active }: { active: boolean }) {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.7} strokeLinecap="round" aria-hidden>
      <path d="M5 20V12M12 20V5M19 20v-8" />
    </svg>
  );
}
