// Recording the learner's own voice (for shadowing and speaking practice), and the browser's
// speech recognition where it has one. Both are free and built into the browser; recordings stay
// in memory and are never saved or uploaded.

export function recordingSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

/** Safari records MP4/AAC, Chrome and Firefox WebM/Opus. */
function mimeType(): string | undefined {
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return undefined;
}

/**
 * Keeps the microphone open while a practice page is in use (asking once), and records one take
 * at a time. Call `release` when leaving the page so the microphone indicator goes away.
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async start(): Promise<void> {
    if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = mimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start();
  }

  /** Stops the take and returns it as an object URL (revoke it when done). */
  stop(): Promise<string | null> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/mp4' });
        resolve(blob.size ? URL.createObjectURL(blob) : null);
      };
      rec.stop();
    });
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  release(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }
}

// --- Speech recognition --------------------------------------------------------------------

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return !!recognitionCtor();
}

/**
 * Listens once and resolves with what was heard (several guesses, best first). Rejects when the
 * browser can't (no permission, offline on some browsers, nothing said).
 */
export function listenOnce(locale: string, signal?: AbortSignal): Promise<string[]> {
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.reject(new Error('Speech recognition is not available in this browser.'));
  return new Promise((resolve, reject) => {
    const r = new Ctor();
    r.lang = locale;
    r.interimResults = false;
    r.maxAlternatives = 3;
    let heard: string[] = [];
    let failed = false;
    r.onresult = (e) => {
      const first = e.results[0];
      heard = Array.from({ length: first.length }, (_, i) => first[i].transcript);
    };
    r.onerror = (e) => {
      failed = true;
      reject(new Error(e.error === 'no-speech' ? 'Nothing was heard. Try again a little louder.' : `Speech recognition failed (${e.error}).`));
    };
    r.onend = () => {
      if (failed) return;
      if (heard.length) resolve(heard);
      else reject(new Error('Nothing was heard. Try again a little louder.'));
    };
    signal?.addEventListener('abort', () => r.abort());
    r.start();
  });
}

/** Text compared by sound and letters only: no punctuation or spaces, katakana as hiragana. */
export function normalizeSpoken(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\s、。！？!?,.「」『』（）()・〜~-]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Which characters of the target were said: a longest-common-subsequence match between the
 * target and what was heard, so a missing or extra word only affects its own characters.
 * Returns the share matched and, per target character (after normalizing), whether it was heard.
 */
export function compareSpoken(target: string, heard: string): { score: number; hit: boolean[] } {
  const a = [...normalizeSpoken(target)];
  const b = [...normalizeSpoken(heard)];
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array<boolean>(a.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      hit[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { score: a.length ? dp[0][0] / a.length : 0, hit };
}

/** The best of several guesses of what was heard, scored against any of the accepted answers. */
export function bestMatch(targets: string[], guesses: string[]): { heard: string; score: number } {
  let best = { heard: guesses[0] ?? '', score: 0 };
  for (const g of guesses) for (const t of targets) {
    const score = compareSpoken(t, g).score;
    if (score > best.score) best = { heard: g, score };
  }
  return best;
}
