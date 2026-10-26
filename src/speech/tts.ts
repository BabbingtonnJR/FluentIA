// Text-to-speech through the browser's built-in voices (free, works offline on iOS).

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Voices load asynchronously on most browsers, so wait for them once. */
export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([]);
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      const now = speechSynthesis.getVoices();
      if (now.length) return resolve(now);
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
    voicesPromise.then((v) => {
      if (!v.length) voicesPromise = null; // try again next time
    });
  }
  return voicesPromise;
}

/**
 * How natural a voice sounds, from its name: neural and "natural" voices (Edge, Android, Chrome's
 * online voices) and the downloadable Enhanced / Premium voices on Apple devices are far less
 * robotic than the compact defaults. Higher is better.
 */
export function voiceQuality(v: Pick<SpeechSynthesisVoice, 'name' | 'localService'>): number {
  const n = v.name.toLowerCase();
  if (/neural|natural/.test(n)) return 4;
  if (/premium/.test(n)) return 3;
  if (/enhanced|拡張/.test(n)) return 2;
  if (/google/.test(n)) return 1;
  // Novelty voices on Apple devices (Bells, Bubbles…) are never Japanese, but compact ones are the most robotic.
  if (/compact/.test(n)) return -1;
  return 0;
}

/** Voices for a language, the most natural first. */
export async function voicesFor(locale: string): Promise<SpeechSynthesisVoice[]> {
  const lang = locale.split('-')[0];
  return (await getVoices())
    .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang))
    .sort((a, b) => voiceQuality(b) - voiceQuality(a) || Number(b.localService) - Number(a.localService));
}

export interface SpeakOptions {
  locale: string;
  voiceURI?: string | null;
  rate?: number;
  /** A second speaker in a dialogue: another voice if there is one, otherwise the same voice pitched differently. */
  alt?: boolean;
}

/** The chosen voice, or the most natural one; for `alt`, the best one that sounds like someone else. */
function pickVoice(voices: SpeechSynthesisVoice[], opts: SpeakOptions): { voice?: SpeechSynthesisVoice; pitch: number } {
  const main = voices.find((v) => v.voiceURI === opts.voiceURI) ?? voices[0];
  if (!opts.alt) return { voice: main, pitch: 1 };
  // Kyoko and Kyoko (Enhanced) are the same person: compare first names.
  const person = (v?: SpeechSynthesisVoice) => v?.name.split(/[\s(]/)[0].toLowerCase();
  const other = voices.find((v) => person(v) !== person(main));
  return other ? { voice: other, pitch: 1 } : { voice: main, pitch: 1.25 };
}

/** Speaks text and resolves when finished (or after a timeout, since iOS sometimes never fires `end`). */
export async function speak(text: string, opts: SpeakOptions): Promise<void> {
  if (!ttsSupported() || !text) return;
  const { voice, pitch } = pickVoice(await voicesFor(opts.locale), opts);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.locale;
  if (voice) u.voice = voice;
  u.rate = opts.rate ?? 1;
  u.pitch = pitch;
  speechSynthesis.cancel();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1500 + text.length * 400);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking(): void {
  if (ttsSupported()) speechSynthesis.cancel();
}
