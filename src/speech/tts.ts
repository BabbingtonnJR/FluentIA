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

export async function voicesFor(locale: string): Promise<SpeechSynthesisVoice[]> {
  const lang = locale.split('-')[0];
  return (await getVoices()).filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang));
}

export interface SpeakOptions {
  locale: string;
  voiceURI?: string | null;
  rate?: number;
}

/** Speaks text and resolves when finished (or after a timeout, since iOS sometimes never fires `end`). */
export async function speak(text: string, opts: SpeakOptions): Promise<void> {
  if (!ttsSupported() || !text) return;
  const voices = await voicesFor(opts.locale);
  const voice = voices.find((v) => v.voiceURI === opts.voiceURI) ?? voices.find((v) => v.localService) ?? voices[0];
  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.locale;
  if (voice) u.voice = voice;
  u.rate = opts.rate ?? 1;
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
