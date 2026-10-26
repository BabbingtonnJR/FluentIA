// Text-to-speech through the browser's built-in voices (free, works offline on iOS), or the
// natural recordings made with VOICEVOX where there is one (see audio.ts).
import { loadAudioIndex, playRecording, stopRecording, textKey } from './audio';

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

const langOf = (locale: string) => locale.split('-')[0];

/** Plays the recording of a text if there is one; false when there isn't. */
async function playText(text: string, opts: SpeakOptions): Promise<boolean> {
  const lang = langOf(opts.locale);
  const index = await loadAudioIndex(lang);
  const key = textKey(text);
  const file = (opts.alt ? index.alt[key] : undefined) ?? index.text[key];
  return !!file && (await playRecording(`/audio/${lang}/${file}`, opts.rate ?? 1));
}

/**
 * Says a word from the word list: its recording, one per reading (十: じゅう, とお), or the
 * browser's voice reading `fallback` when a recording is missing.
 */
export async function speakWords(vocabIds: string[], fallback: string, opts: SpeakOptions): Promise<void> {
  const lang = langOf(opts.locale);
  const index = await loadAudioIndex(lang);
  const files = vocabIds.map((id) => index.words[id]);
  if (!files.length || files.some((f) => !f)) return speak(fallback, opts);
  for (const [i, f] of files.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 250));
    if (!(await playRecording(`/audio/${lang}/${f}`, opts.rate ?? 1))) return speak(fallback, opts);
  }
}

/** Speaks text and resolves when finished (or after a timeout, since iOS sometimes never fires `end`). */
export async function speak(text: string, opts: SpeakOptions): Promise<void> {
  if (!text) return;
  if (await playText(text, opts)) return;
  if (!ttsSupported()) return;
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
  stopRecording();
  if (ttsSupported()) speechSynthesis.cancel();
}
