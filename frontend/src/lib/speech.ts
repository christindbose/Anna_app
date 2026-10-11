import { getServerBase } from "./api";
/* Read-aloud for attending replies using the browser's SpeechSynthesis.
 * Voice choice is best-effort: pick an installed voice matching the attending's language and
 * gender hint, else any voice for that language, else the browser default. */

export interface VoiceHint {
  lang: string;
  gender: string;
  rate: number;
  pitch: number;
  accent: string;
}

const FEMALE_HINTS = /female|woman|samantha|karen|moira|tessa|veena|kate|serena|fiona|victoria|allison|ava|susan|zira|hazel|aditi|raveena|lekha|isha|neerja|sonia|libby/i;
const MALE_HINTS = /\bmale\b|\bman\b|daniel|alex|fred|arthur|gordon|oliver|rishi|ravi|prabhat|david|george|james|mark|tom|aaron|lee|jamie|ryan|guy/i;

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && (("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) || "Audio" in window);
}

let voicesCache: SpeechSynthesisVoice[] = [];
function loadVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return [];
  const v = window.speechSynthesis.getVoices();
  if (v.length) voicesCache = v;
  return voicesCache;
}
if (ttsSupported()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

export function pickVoice(hint: VoiceHint): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (!voices.length) return null;
  const lang = hint.lang.toLowerCase();
  const base = lang.split("-")[0];
  const genderRe = hint.gender === "female" ? FEMALE_HINTS : MALE_HINTS;
  const otherRe = hint.gender === "female" ? MALE_HINTS : FEMALE_HINTS;
  const score = (v: SpeechSynthesisVoice) => {
    const vl = v.lang.toLowerCase().replace("_", "-");
    let s = 0;
    if (vl === lang) s += 40;
    else if (vl.startsWith(base)) s += 15;
    else return -1;
    if (genderRe.test(v.name) && !otherRe.test(v.name)) s += 20;
    else if (otherRe.test(v.name)) s -= 10;
    if (/premium|enhanced|neural|natural/i.test(v.name)) s += 5;
    if (v.localService) s += 2;
    return s;
  };
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = score(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

/** Strip markdown-ish noise so it reads naturally. */
function clean(text: string): string {
  return text
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- server-side neural voices (Kokoro via /api/tts) ---------- */

let serverTts: boolean | null = null; // null = unknown yet
let audioEl: HTMLAudioElement | null = null;
let queueToken = 0;

function getAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
  }
  return audioEl;
}

/** Call from a user gesture (the toggle tap) so later programmatic playback is allowed on iOS. */
export function unlockAudio(): void {
  try {
    const a = getAudio();
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    void a.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export async function probeServerTts(): Promise<boolean> {
  if (serverTts !== null) return serverTts;
  try {
    const pw = (() => {
      try {
        return window.localStorage.getItem("anna_pw") ?? "";
      } catch {
        return "";
      }
    })();
    const r = await fetch(`${getServerBase()}/api/tts/health`, { headers: pw ? { "X-App-Password": pw } : {} });
    const j = (await r.json()) as { ok?: boolean };
    serverTts = Boolean(j.ok);
  } catch {
    serverTts = false;
  }
  return serverTts;
}

function sentences(text: string): string[] {
  const body = clean(text);
  const parts = body.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [body];
  // Group into ~220-char chunks so each request is short but not choppy.
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > 220 && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += p + " ";
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function fetchWav(text: string, attendingId: string, signal: AbortSignal): Promise<string> {
  const pw = (() => {
    try {
      return window.localStorage.getItem("anna_pw") ?? "";
    } catch {
      return "";
    }
  })();
  const r = await fetch(`${getServerBase()}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(pw ? { "X-App-Password": pw } : {}) },
    body: JSON.stringify({ text, attending_id: attendingId }),
    signal,
  });
  if (!r.ok) throw new Error(`tts ${r.status}`);
  return URL.createObjectURL(await r.blob());
}

let abortCtrl: AbortController | null = null;

/** Speak with the server voice: sentences are fetched ahead of playback and played in order. */
export async function speakServer(text: string, attendingId: string, onEnd?: () => void): Promise<void> {
  stopSpeaking();
  const token = ++queueToken;
  const ctrl = new AbortController();
  abortCtrl = ctrl;
  const a = getAudio();
  const parts = sentences(text);
  if (!parts.length) return;
  // Prefetch all chunks concurrently; play sequentially as they arrive.
  const urls = parts.map((p) => fetchWav(p, attendingId, ctrl.signal));
  try {
    for (const u of urls) {
      const url = await u;
      if (token !== queueToken) {
        URL.revokeObjectURL(url);
        return;
      }
      await new Promise<void>((resolve) => {
        a.onended = () => resolve();
        a.onerror = () => resolve();
        a.src = url;
        a.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      if (token !== queueToken) return;
    }
    onEnd?.();
  } catch {
    /* aborted or network error: fall through silently */
  }
}

/** Public entry point: server voice if available, else browser voice. */
export async function speakAs(text: string, attendingId: string, hint: VoiceHint, onEnd?: () => void): Promise<void> {
  if (await probeServerTts()) return speakServer(text, attendingId, onEnd);
  speak(text, hint, onEnd);
}

export function speak(text: string, hint: VoiceHint, onEnd?: () => void): void {
  if (!ttsSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const body = clean(text);
  if (!body) return;
  // Long texts are split so iOS does not cut off mid-utterance.
  const chunks = body.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [body];
  const voice = pickVoice(hint);
  let remaining = chunks.length;
  for (const c of chunks) {
    const u = new SpeechSynthesisUtterance(c.trim());
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? hint.lang;
    u.rate = hint.rate;
    u.pitch = hint.pitch;
    u.onend = () => {
      remaining -= 1;
      if (remaining === 0) onEnd?.();
    };
    synth.speak(u);
  }
}

export function stopSpeaking(): void {
  queueToken += 1;
  abortCtrl?.abort();
  abortCtrl = null;
  if (audioEl) {
    try {
      audioEl.pause();
      audioEl.removeAttribute("src");
      audioEl.load();
    } catch {
      /* ignore */
    }
  }
  if (ttsSupported()) window.speechSynthesis.cancel();
}

const KEY = "anna_tts";
export function readAloudEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
export function setReadAloudEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
