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
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
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
