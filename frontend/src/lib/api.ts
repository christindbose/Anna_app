/* API client for the FastAPI backend (same-origin via the /api rewrite). */

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
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...rest,
      headers: { ...buildHeaders(rest.body != null), ...(rest.headers as Record<string, string> | undefined) },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
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

export type Track = "general-im" | "rheum";
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

export const attendingAvatar = (id: string) => `/attendings/${encodeURIComponent(id)}.svg`;
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

export const TRACK_LABEL: Record<string, string> = { "general-im": "General IM", rheum: "Rheum" };
export const CATEGORIES: Category[] = ["diagnosis", "workup", "reasoning", "management"];
