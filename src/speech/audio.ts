// Natural recorded voices: audio made on a PC with VOICEVOX (free neural text-to-speech, see
// tools/voices-to-fluentia.ps1) for every word and the speaking lines. Where a recording exists it
// is played instead of the browser's voice; anything else still uses the browser's voice.

export interface AudioIndex {
  /** Who the voices are, to credit (VOICEVOX's terms ask for it). */
  credit?: string;
  /** Recording of a word-list entry, by vocab id. */
  words: Record<string, string>;
  /** Recording of a text (a reading or a sentence) in the main voice… */
  text: Record<string, string>;
  /** …and in the second voice, for the other speaker in dialogues. */
  alt: Record<string, string>;
}

const EMPTY: AudioIndex = { words: {}, text: {}, alt: {} };
const indexes = new Map<string, Promise<AudioIndex>>();

/** The recordings for a language; empty when none were made (the browser voice is used). */
export function loadAudioIndex(lang: string): Promise<AudioIndex> {
  let p = indexes.get(lang);
  if (!p) {
    p = fetch(`/audio/${lang}/index.json`)
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? (r.json() as Promise<AudioIndex>) : EMPTY))
      .then((i) => ({ ...EMPTY, ...i }))
      .catch(() => EMPTY);
    indexes.set(lang, p);
  }
  return p;
}

/** Same text, same recording: spacing and the final full stop don't matter. */
export const textKey = (text: string) => text.replace(/\s+/g, '').replace(/[。.]$/, '');

// One player for every recording. iOS only lets a page play sound that starts from a tap, and a
// recording starts after the index has loaded, a moment too late. A player that has played once
// from a tap may play again later, so the first tap anywhere plays a short silence on it.
let player: HTMLAudioElement | null = null;
let finish: ((ok: boolean) => void) | null = null;
const getPlayer = () => (player ??= new Audio());

/** Plays a recording and resolves when it ends (or fails, or is stopped). */
export function playRecording(url: string, rate = 1): Promise<boolean> {
  stopRecording();
  return new Promise((resolve) => {
    const a = getPlayer();
    const done = (ok: boolean) => {
      if (finish !== done) return;
      finish = null;
      a.onended = a.onerror = null;
      resolve(ok);
    };
    finish = done;
    a.onended = () => done(true);
    a.onerror = () => done(false);
    a.src = url;
    a.playbackRate = rate;
    // Keep the pitch when slowed down; the voice should sound the same, only slower.
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    a.play().catch(() => done(false));
  });
}

export function stopRecording(): void {
  const f = finish;
  if (!f) return;
  player?.pause();
  f(true);
}

/** A tenth of a second of silence, as a WAV file. */
function silence(): string {
  const n = 800;
  const bytes = new Uint8Array(44 + n).fill(128);
  const v = new DataView(bytes.buffer);
  const text = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, 'data');
  v.setUint32(40, n, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/**
 * Lets sound play from then on: on the first tap or key press, the player plays a silence and the
 * browser's voice says nothing. Also starts loading the recordings' index, so they start sooner.
 */
export function unlockAudioOnFirstTap(lang: string): void {
  const events = ['touchend', 'pointerup', 'keydown'] as const;
  const unlock = () => {
    events.forEach((e) => window.removeEventListener(e, unlock, true));
    void loadAudioIndex(lang);
    if (!finish) {
      const a = getPlayer();
      a.src = silence();
      a.play().catch(() => {});
    }
    if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  };
  events.forEach((e) => window.addEventListener(e, unlock, true));
}
