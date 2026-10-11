/* API client for the FastAPI backend.
 * Served by `next start`, /api is proxied same-origin. In the static GitHub Pages build there is
 * no proxy: the backend address comes from NEXT_PUBLIC_API_BASE at build time or, preferably,
 * from the "Server" setting the user enters in the app (stored in localStorage). */

/** Prefix for files in /public when the site is served under a sub-path (GitHub Pages). */
export const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const STATIC_BUILD = process.env.NEXT_PUBLIC_STATIC === "1";
export const SERVER_KEY = "anna_server";
export const SERVER_EVENT = "anna:server"; // open the server settings sheet
export const UNREACHABLE_EVENT = "anna:unreachable"; // fetch itself failed

export function getServerBase(): string {
  try {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem(SERVER_KEY);
    if (saved) return saved.replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  return (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");
}

export function setServerBase(url: string): void {
  try {
    const v = url.trim().replace(/\/+$/, "");
    if (v) window.localStorage.setItem(SERVER_KEY, v);
    else window.localStorage.removeItem(SERVER_KEY);
  } catch {
    /* private mode */
  }
}

export function openServerSettings(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SERVER_EVENT));
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super(401, "Password required");
    this.name = "UnauthorizedError";
  }
}

export const PW_KEY = "anna_pw";
export const AUTH_EVENT = "anna:auth"; // password saved -> refetch
export const UNAUTHORIZED_EVENT = "anna:unauthorized"; // 401 -> show prompt
export const TOAST_EVENT = "anna:toast";

export function getPassword(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(PW_KEY);
  } catch {
    return null;
  }
}

export function setPassword(pw: string): void {
  try {
    window.localStorage.setItem(PW_KEY, pw);
  } catch {
    /* private mode; keep going */
  }
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function toast(message: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }));
}

export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message || "Something went wrong";
  return "Something went wrong";
}

function notifyUnauthorized() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

function buildHeaders(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  const pw = getPassword();
  if (pw) h["X-App-Password"] = pw;
  return h;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const j: unknown = await res.json();
    if (j && typeof j === "object" && "detail" in j) {
      const d = (j as { detail: unknown }).detail;
      if (typeof d === "string") return d;
    }
  } catch {
    /* no JSON body */
  }
  if (res.status === 409) return "That action isn't available right now.";
  if (res.status === 404) return "Not found.";
  return `Request failed (${res.status})`;
}

async function doFetch(path: string, init: RequestInit & { silent401?: boolean } = {}): Promise<Response> {
  const { silent401, ...rest } = init;
  if (STATIC_BUILD && !getServerBase()) {
    // Hosted on GitHub Pages with no backend address yet: open the server sheet.
    // Deferred: the first fetches fire from page effects before the Shell's listener mounts.
    if (typeof window !== "undefined") setTimeout(() => window.dispatchEvent(new Event(UNREACHABLE_EVENT)), 0);
    throw new ApiError(0, "No server address set. Open Server settings and paste the tunnel link.");
  }
  let res: Response;
  try {
    res = await fetch(`${getServerBase()}/api${path}`, {
      ...rest,
      headers: { ...buildHeaders(rest.body != null), ...(rest.headers as Record<string, string> | undefined) },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (typeof window !== "undefined") window.dispatchEvent(new Event(UNREACHABLE_EVENT));
    throw new ApiError(0, STATIC_BUILD ? "Can't reach the server. Check the server address in settings." : "Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 401) {
    if (!silent401) notifyUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res;
}

async function request<T>(path: string, init?: RequestInit & { silent401?: boolean }): Promise<T> {
  const res = await doFetch(path, init);
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown, extra?: { silent401?: boolean }): Promise<T> {
  return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), ...extra });
}

/* ---------- types (mirror backend/app/main.py) ---------- */

export type Track = string; // a subspecialty folder name under cases/, e.g. "cardio"
export interface Attending {
  id: string;
  name: string;
  title: string;
  difficulty: number;
  credentials: string;
  tagline: string;
  description: string;
  emoji: string;
  signature: string;
  voice: { lang: string; gender: string; rate: number; pitch: number; accent: string; model_voice: string; speed: number };
}

export const attendingAvatar = (id: string) => `${ASSET_BASE}/attendings/${encodeURIComponent(id)}.svg`;
export type Category = "diagnosis" | "workup" | "reasoning" | "management";

export interface Health {
  ok: boolean;
  llm_provider: string;
  llm_model: string;
  learner: string;
}

export interface CaseSummary {
  id: string;
  title: string;
  track: string;
  difficulty: number;
  tags: string[];
  reviewed: boolean;
  n_stages: number;
  completed: boolean;
}

export interface Stage {
  id: string;
  label: string;
  text: string;
  prompt: string;
  available_tests: string[];
}

export interface Turn {
  role: "learner" | "attending";
  stage_index: number;
  content: string;
}

export interface Distractor {
  name: string;
  why_not: string;
}

export interface RubricResultView {
  id: string;
  description: string;
  category: Category | string;
  weight: number;
  hit: boolean;
}

export interface SessionResult {
  score: number | null;
  max_score: number | null;
  final_diagnosis: string | null;
  final_management: string | null;
  debrief: string | null;
  diagnosis: string;
  key_clues: string[];
  distractors: Distractor[];
  management_summary: string;
  teaching_points: string[];
  references: string[];
  rubric: RubricResultView[];
}

export interface SessionView {
  id: string;
  case: {
    id: string;
    title: string;
    track: string;
    difficulty: number;
    presentation: string;
    n_stages: number;
  };
  attending: Attending;
  status: "active" | "finished" | string;
  stage_index: number;
  stages: Stage[];
  turns: Turn[];
  result?: SessionResult;
}

export type AdvanceResponse = { done: true } | { done: false; stage_index: number; stage: Stage };

export interface SessionListItem {
  id: string;
  case_id: string;
  title: string;
  status: string;
  attending_id: string;
  score: number | null;
  max_score: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface ReviewItem {
  id: string;
  concept: string;
  question: string;
  answer: string;
  case_title: string;
  due_at: string;
  repetitions: number;
}

export interface GradeResponse {
  id: string;
  due_at: string;
  interval_days: number;
  repetitions: number;
}

export interface Progress {
  cases_completed: number;
  overall_pct: number | null;
  by_category: Record<string, { hit: number; total: number }>;
  weak_concepts: { concept: string; hit: number; total: number; miss_rate: number }[];
  reviews_due: number;
  recent: {
    session_id: string;
    case_id: string;
    score: number | null;
    max_score: number | null;
    finished_at: string | null;
    attending_id: string;
  }[];
}

/* ---------- endpoints ---------- */

export const api = {
  health: () => request<Health>("/health"),
  authCheck: (silent401 = true) => post<{ ok: boolean }>("/auth/check", undefined, { silent401 }),
  cases: () => request<CaseSummary[]>("/cases"),
  attendings: () => request<Attending[]>("/attendings"),
  ttsHealth: () => request<{ ok: boolean; engine?: string }>("/tts/health"),
  startSession: (body: { case_id?: string | null; attending_id: string; track?: Track | null }) =>
    post<SessionView>("/sessions", body),
  session: (id: string) => request<SessionView>(`/sessions/${encodeURIComponent(id)}`),
  sessions: () => request<SessionListItem[]>("/sessions"),
  advance: (id: string) => post<AdvanceResponse>(`/sessions/${encodeURIComponent(id)}/advance`),
  finish: (id: string, body: { diagnosis: string; management: string }) =>
    post<SessionView>(`/sessions/${encodeURIComponent(id)}/finish`, body),
  reviewsDue: () => request<ReviewItem[]>("/reviews/due"),
  grade: (itemId: string, grade: number) => post<GradeResponse>(`/reviews/${encodeURIComponent(itemId)}/grade`, { grade }),
  progress: () => request<Progress>("/progress"),
};

/**
 * POST a learner message and yield the attending's reply as it streams in.
 * Throws UnauthorizedError / ApiError before the first chunk if the request fails.
 */
export async function* streamRespond(sessionId: string, text: string, signal?: AbortSignal): AsyncGenerator<string> {
  const res = await doFetch(`/sessions/${encodeURIComponent(sessionId)}/respond`, {
    method: "POST",
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.body) {
    const whole = await res.text();
    if (whole) yield whole;
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) yield chunk;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/* ---------- small helpers ---------- */

/** Backend timestamps are naive UTC ISO strings; treat them as UTC. */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
  const d = new Date(hasTz ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(s: string | null | undefined): string {
  const d = parseDate(s);
  if (!d) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export const TRACK_LABEL: Record<string, string> = {
  cardio: "Cardiology",
  nephro: "Nephrology",
  pulm: "Pulmonology",
  gi: "GI & Hepatology",
  heme: "Hematology",
  onc: "Oncology",
  id: "Infectious Disease",
  endo: "Endocrinology",
  rheum: "Rheumatology",
  neuro: "Neurology",
  "general-im": "General IM",
};
export const trackLabel = (t: string) => TRACK_LABEL[t] ?? t;
export const CATEGORIES: Category[] = ["diagnosis", "workup", "reasoning", "management"];
