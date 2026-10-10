import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { cardFace } from '../content/faces';
import { db } from '../db/db';
import { answerCard, buildSession, markItemKnown, startCard } from '../db/repo';
import type { CardRecord } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { formatInterval } from '../lib/time';
import { speak, stopSpeaking } from '../speech/tts';
import { GRADE_LABELS, GRADES, previewIntervals, Rating, State, type Grade } from '../srs/scheduler';
import { REQUEUE_WITHIN_MS, requeuePosition, type QueueEntry } from '../srs/queue';

const GRADE_CLASS: Record<Grade, string> = {
  [Rating.Again]: 'again',
  [Rating.Hard]: 'hard',
  [Rating.Good]: 'good',
  [Rating.Easy]: 'easy',
};

export function Study() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [card, setCard] = useState<CardRecord | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ reviewed: 0, learned: 0, again: 0 });
  const shownAt = useRef(Date.now());
  const busy = useRef(false);

  // Build the queue once per visit so it does not shift while studying.
  useEffect(() => {
    let alive = true;
    buildSession(pack, settings).then((s) => alive && setQueue(s.queue));
    return () => {
      alive = false;
      stopSpeaking();
    };
  }, [pack]); // settings intentionally read once

  const entry = queue?.[cursor];

  useEffect(() => {
    if (!entry) {
      setCard(null);
      return;
    }
    let alive = true;
    const load = async () => {
      const rec = entry.type === 'review' ? await db.cards.get(entry.cardId) : startCard(entry.ref);
      if (!alive) return;
      setCard(rec ?? null);
      setRevealed(false);
      shownAt.current = Date.now();
      if (!rec) setCursor((c) => c + 1); // card disappeared (e.g. deleted by sync); skip it
    };
    void load();
    return () => {
      alive = false;
    };
  }, [entry]);

  const face = card ? cardFace(pack, card.kind, card.direction, card.itemId) : null;
  const say = useCallback(
    (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate }),
    [pack, settings.voiceURI, settings.speechRate],
  );

  const reveal = useCallback(() => {
    if (!face || revealed) return;
    setRevealed(true);
    if (settings.autoplay) void say(face.speak);
  }, [face, revealed, settings.autoplay, say]);

  const grade = useCallback(
    async (g: Grade) => {
      if (!card || !queue || busy.current) return;
      busy.current = true;
      stopSpeaking();
      const now = Date.now();
      const wasNew = card.state === State.New;
      const next = await answerCard(card, g, Math.min(now - shownAt.current, 120_000), now);
      setStats((s) => ({
        reviewed: s.reviewed + (wasNew ? 0 : 1),
        learned: s.learned + (wasNew ? 1 : 0),
        again: s.again + (g === Rating.Again ? 1 : 0),
      }));
      if (next.due - now < REQUEUE_WITHIN_MS) {
        const q = [...queue];
        q.splice(requeuePosition(q.length, cursor), 0, { type: 'review', cardId: next.id });
        setQueue(q);
      }
      setCursor((c) => c + 1);
      busy.current = false;
    },
    [card, queue, cursor],
  );

  const alreadyKnown = useCallback(async () => {
    if (!entry || entry.type !== 'new') return;
    await markItemKnown(entry.ref);
    setCursor((c) => c + 1);
  }, [entry]);

  // Keyboard: space/enter reveals, 1–4 grade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        reveal();
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        void grade(Number(e.key) as Grade);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reveal, grade, revealed]);

  if (!queue) return null;

  if (!entry) {
    return (
      <div className="stack">
        <div className="empty">
          <span className="jp">{queue.length ? 'お疲れ様' : '完了'}</span>
          {queue.length ? (
            <>
              <h2 style={{ margin: '0 0 8px' }}>Session complete</h2>
              <p>
                {stats.learned} new · {stats.reviewed} reviews
                {stats.reviewed + stats.learned > 0 &&
                  ` · ${Math.round(((stats.reviewed + stats.learned - stats.again) / (stats.reviewed + stats.learned)) * 100)}% remembered`}
              </p>
            </>
          ) : (
            <p>Nothing due right now. Come back later, or raise your daily new cards in Settings.</p>
          )}
        </div>
        <Link to="/quiz" className="btn primary block">
          Take the daily quiz
        </Link>
        <Link to="/" className="btn block">
          Back to Today
        </Link>
      </div>
    );
  }

  if (!card || !face) return null;
  const intervals = revealed ? previewIntervals(card, Date.now()) : null;
  const isNew = card.state === State.New;
  const isKanji = card.kind === 'kanji';

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="End session">
          <Icon name="close" />
        </button>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(cursor / queue.length) * 100}%` }} />
        </div>
        <span className="faint" style={{ minWidth: 48, textAlign: 'right' }}>
          {queue.length - cursor} left
        </span>
      </div>

      <div className="card flashcard" onClick={reveal} role="button" tabIndex={0} aria-label={revealed ? undefined : 'Show answer'}>
        <div className="row" style={{ gap: 6 }}>
          {isNew && <span className="badge new">New</span>}
          <span className="badge">
            {pack.manifest.levels.find((l) => l.id === card.level)?.label} ·{' '}
            {isKanji ? 'Kanji' : card.direction === 'production' ? 'Say it in Japanese' : 'Word'}
          </span>
        </div>

        <div className={face.promptIsTarget ? (isKanji ? 'prompt-kanji' : 'prompt-jp') : 'prompt-en'} lang={face.promptIsTarget ? 'ja' : 'en'}>
          {face.prompt}
        </div>

        {revealed ? (
          <div className="answer">
            {!face.promptIsTarget && (
              <div className="prompt-jp" lang="ja" style={{ fontSize: '2.4rem' }}>
                {face.answer}
              </div>
            )}
            {face.reading && (
              <div className="reading" lang="ja">
                {face.reading}
              </div>
            )}
            {face.promptIsTarget && <div className="meaning">{face.answer}</div>}
            {face.details?.map((d) => (
              <div key={d} className="muted jp" lang="ja">
                {d}
              </div>
            ))}
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                void say(face.speak);
              }}
              aria-label="Play audio"
              style={{ marginTop: 8 }}
            >
              <Icon name="speaker" />
            </button>
            {isKanji && (
              <Link to={`/kanji/${encodeURIComponent(card.itemId)}`} className="faint" onClick={(e) => e.stopPropagation()}>
                Stroke order & words →
              </Link>
            )}
          </div>
        ) : (
          <div className="faint">Tap to reveal</div>
        )}
      </div>

      <div className="study-footer">
        {revealed && intervals ? (
          <div className="grades">
            {GRADES.map((g) => (
              <button key={g} className={`grade ${GRADE_CLASS[g]}`} onClick={() => void grade(g)}>
                {GRADE_LABELS[g]}
                <small>{formatInterval(intervals[g])}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <button className="btn primary block" onClick={reveal}>
              Show answer
            </button>
            {isNew && (
              <button className="btn ghost block" onClick={() => void alreadyKnown()}>
                I already know this
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
