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

let current: HTMLAudioElement | null = null;

/** Plays a recording and resolves when it ends (or fails, or is stopped). */
export function playRecording(url: string, rate = 1): Promise<boolean> {
  stopRecording();
  return new Promise((resolve) => {
    const a = new Audio(url);
    current = a;
    a.playbackRate = rate;
    // Keep the pitch when slowed down; the voice should sound the same, only slower.
    (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    const done = (ok: boolean) => {
      a.onended = a.onerror = a.onpause = null;
      if (current === a) current = null;
      resolve(ok);
    };
    a.onended = () => done(true);
    a.onerror = () => done(false);
    a.onpause = () => done(true);
    a.play().catch(() => done(false));
  });
}

export function stopRecording(): void {
  if (current) {
    current.pause();
    current = null;
  }
}
