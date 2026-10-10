import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { cardFace } from '../content/faces';
import type { CardFace } from '../content/types';
import { db } from '../db/db';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { speak, stopSpeaking } from '../speech/tts';
import { State } from '../srs/scheduler';

type Order = 'jp-en' | 'en-jp';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * Hands-free review: speaks each word, pauses so you can recall it, then speaks the answer.
 * Uses cards you have already studied, most at-risk first. It does not change scheduling.
 */
export function Listen() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order>('jp-en');
  const [pause, setPause] = useState(3);
  const [items, setItems] = useState<CardFace[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const startedAt = useRef<number | null>(null);
  const listenedMs = useRef(0);

  useEffect(() => {
    const lang = pack.manifest.id;
    db.cards
      .where('[lang+kind]')
      .equals([lang, 'vocab'])
      .filter((c) => c.direction === 'recognition' && c.state !== State.New)
      .sortBy('due')
      .then((cards) => {
        const faces = cards
          .slice(0, 60)
          .map((c) => cardFace(pack, 'vocab', 'recognition', c.itemId))
          .filter((f): f is CardFace => !!f);
        setItems(faces);
      });
  }, [pack]);

  // Save listening time when leaving the page.
  useEffect(
    () => () => {
      abort.current?.abort();
      stopSpeaking();
      const total = listenedMs.current + (startedAt.current ? Date.now() - startedAt.current : 0);
      const minutes = Math.floor(total / 60_000);
      if (minutes > 0) void logActivity(pack.manifest.id, 'handsfree', { minutes }, settings);
    },
    [], // runs on unmount only
  );

  // Keep the screen on while playing (speech stops if the phone locks).
  useEffect(() => {
    if (!playing || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => {
      void lock?.release();
    };
  }, [playing]);

  async function run(start: number) {
    if (!items?.length) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    startedAt.current = Date.now();
    const jp = { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate };
    const en = { locale: 'en-US', rate: 1 };
    for (let i = start; !ctrl.signal.aborted; i = (i + 1) % items.length) {
      const f = items[i];
      setIndex(i);
      setShowAnswer(false);
      if (order === 'jp-en') await speak(f.speak, jp);
      else await speak(f.meaning, en);
      await sleep(pause * 1000, ctrl.signal);
      if (ctrl.signal.aborted) break;
      setShowAnswer(true);
      if (order === 'jp-en') await speak(f.meaning, en);
      else await speak(f.speak, jp);
      await sleep(1200, ctrl.signal);
      // Repeat the Japanese once more to reinforce the sound.
      if (!ctrl.signal.aborted) await speak(f.speak, jp);
      await sleep(1500, ctrl.signal);
    }
  }

  function toggle() {
    if (playing) {
      abort.current?.abort();
      stopSpeaking();
      if (startedAt.current) listenedMs.current += Date.now() - startedAt.current;
      startedAt.current = null;
      setPlaying(false);
    } else {
      setPlaying(true);
      void run(index);
    }
  }

  if (!items) return null;
  const current = items[index];

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Close">
          <Icon name="close" />
        </button>
        <strong style={{ flex: 1 }}>
          Hands-free <span className="jp" style={{ color: 'var(--accent)' }}>聞く</span>
        </strong>
      </div>

      {!items.length ? (
        <div className="empty">
          <span className="jp">静</span>
          Study a few words first — hands-free mode plays back words you have already learned.
        </div>
      ) : (
        <>
          <div className="card flashcard" style={{ cursor: 'default' }} aria-live="polite">
            <div className="faint">
              {index + 1} / {items.length}
            </div>
            {order === 'jp-en' || showAnswer ? (
              <div className="prompt-jp" lang="ja">
                {current.prompt}
              </div>
            ) : (
              <div className="prompt-en">{current.meaning}</div>
            )}
            {showAnswer && (
              <div className="answer">
                {current.reading && <div className="reading">{current.reading}</div>}
                <div className="meaning">{current.meaning}</div>
              </div>
            )}
          </div>

          <button className="btn primary block" onClick={toggle} style={{ minHeight: 56 }}>
            <Icon name={playing ? 'pause' : 'play'} />
            {playing ? 'Pause' : 'Play'}
          </button>

          <div className="card stack">
            <div className="field">
              <span className="label">Order</span>
              <div className="segmented" role="group">
                <button className={order === 'jp-en' ? 'on' : ''} onClick={() => setOrder('jp-en')} disabled={playing}>
                  Japanese → English
                </button>
                <button className={order === 'en-jp' ? 'on' : ''} onClick={() => setOrder('en-jp')} disabled={playing}>
                  English → Japanese
                </button>
              </div>
            </div>
            <div className="field">
              <span className="label">Thinking time</span>
              <div className="segmented" role="group">
                {[2, 3, 5, 8].map((s) => (
                  <button key={s} className={pause === s ? 'on' : ''} onClick={() => setPause(s)} disabled={playing}>
                    {s}s
                  </button>
                ))}
              </div>
            </div>
            <p className="faint" style={{ margin: 0 }}>
              English → Japanese trains you to speak without freezing. Keep the screen on: iPhone stops web audio when
              the phone locks.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
