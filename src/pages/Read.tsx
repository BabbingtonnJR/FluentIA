import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { loadSentences } from '../content/packs';
import type { Sentence } from '../content/types';
import { db } from '../db/db';
import { logActivity, saveSettings } from '../db/repo';
import type { Settings } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { afterMotion } from '../lib/motion';
import { dayKey } from '../lib/time';
import { FURIGANA_LABEL, plainText } from '../reading/furigana';
import { pickReading, unknownWords } from '../reading/select';
import { speak, stopSpeaking } from '../speech/tts';
import { State } from '../srs/scheduler';
import { READING_GOAL } from '../stats/quests';

const FURIGANA_NEXT: Record<Settings['furigana'], Settings['furigana']> = { all: 'unknown', unknown: 'none', none: 'all' };

interface Known {
  words: Set<number>;
  kanji: Set<string>;
}

/**
 * Daily reading: a few real sentences (Tatoeba) made of words you have studied, plus one
 * new word in some of them. Tap a sentence for its translation, audio and the words it uses.
 */
export function Read() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [all, setAll] = useState<Sentence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<Known | null>(null);
  const [batch, setBatch] = useState(0);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const lang = pack.manifest.id;

  const vocabIndex = useMemo(() => new Map(pack.vocab.map((v, i) => [v.id, i])), [pack]);

  useEffect(() => {
    let alive = true;
    loadSentences(lang).then(
      (s) => alive && setAll(s),
      (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    // What counts as known is fixed for the visit, so the reading does not reshuffle mid-way.
    db.cards
      .where('[lang+due]')
      .between([lang, -Infinity], [lang, Infinity])
      .filter((c) => c.state !== State.New)
      .toArray()
      .then((cards) => {
        if (!alive) return;
        const words = new Set<number>();
        const kanji = new Set<string>();
        for (const c of cards) {
          if (c.kind === 'kanji') kanji.add(c.itemId);
          else if (vocabIndex.has(c.itemId)) words.add(vocabIndex.get(c.itemId)!);
        }
        setKnown({ words, kanji });
      });
    return () => {
      alive = false;
      stopSpeaking();
    };
  }, [lang, vocabIndex]);

  const today = dayKey(Date.now(), settings.dayStartHour);
  const reading = useMemo(
    () => (all && known ? pickReading(all, known.words, `${today}#${batch}`, READING_GOAL, seen) : null),
    [all, known, today, batch], // `seen` only changes together with `batch`
  );

  const sentence = reading?.[index];
  const done = !!reading && index >= reading.length;

  // Count the batch once it is finished.
  useEffect(() => {
    if (done && reading?.length) void logActivity(lang, 'reading', { score: reading.length, total: reading.length }, settings);
  }, [done]); // only when a batch completes

  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  function reveal() {
    if (!sentence || revealed) return;
    setRevealed(true);
    if (settings.autoplay) void say(plainText(sentence.r));
  }

  async function next() {
    if (leaving) return;
    stopSpeaking();
    setLeaving(true);
    await afterMotion(200);
    setIndex((i) => i + 1);
    setRevealed(false);
    setLeaving(false);
  }

  function moreSentences() {
    if (!reading) return;
    setSeen((s) => new Set([...s, ...reading.map((r) => r.i)]));
    setBatch((b) => b + 1);
    setIndex(0);
    setRevealed(false);
  }

  // Keyboard: space/enter reveals, then moves on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (!revealed) reveal();
      else void next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) {
    return (
      <div className="empty">
        <span className="jp">困</span>
        Could not load the reading sentences. Open the app once while online so they are saved for offline use.
        <div className="faint">{error}</div>
      </div>
    );
  }
  if (!reading || !known) return null;

  if (done || !sentence) {
    const met = new Set(reading.flatMap((s) => unknownWords(s, known.words)));
    return (
      <div className="stack">
        {reading.length > 0 && <Petals />}
        <div className="empty">
          <span className="jp stamp">読了</span>
          <h2 style={{ margin: '0 0 8px' }}>Reading done</h2>
          <p>
            {reading.length} sentences
            {met.size > 0 && ` · ${met.size} new ${met.size === 1 ? 'word' : 'words'} met in context`}
          </p>
        </div>
        <button className="btn primary block" onClick={moreSentences}>
          Read {READING_GOAL} more
        </button>
        <Link to="/" className="btn block">
          Back to Today
        </Link>
      </div>
    );
  }

  const fresh = unknownWords(sentence, known.words);

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="End reading">
          <Icon name="close" />
        </button>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(index / reading.length) * 100}%` }} />
        </div>
        <button
          className="chip"
          onClick={() => void saveSettings({ furigana: FURIGANA_NEXT[settings.furigana] })}
          aria-label={`Furigana: ${FURIGANA_LABEL[settings.furigana]}. Tap to change.`}
        >
          <span className="jp" lang="ja">
            ふ
          </span>{' '}
          {FURIGANA_LABEL[settings.furigana]}
        </button>
      </div>

      <div
        key={`${batch}-${index}`}
        className={`card flashcard reading-card${leaving ? ' leaving' : ''}`}
        onClick={reveal}
        role="button"
        tabIndex={0}
        aria-label={revealed ? undefined : 'Show translation'}
      >
        <div className="row" style={{ gap: 6 }}>
          <span className="badge">N{sentence.l}</span>
          {fresh.length > 0 && <span className="badge new">{fresh.length === 1 ? '1 new word' : `${fresh.length} new words`}</span>}
        </div>

        <p className="sentence" lang="ja">
          <Ruby markup={sentence.r} mode={settings.furigana} knownKanji={known.kanji} />
        </p>

        {revealed ? (
          <div className="answer">
            <div className="meaning">{sentence.e}</div>
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                void say(plainText(sentence.r));
              }}
              aria-label="Play audio"
            >
              <Icon name="speaker" />
            </button>
            <ul className="word-list">
              {sentence.w.map((w, n) => {
                const v = pack.vocab[w];
                return (
                  <li key={w} style={{ '--i': n } as CSSProperties}>
                    <button
                      className="word"
                      onClick={(e) => {
                        e.stopPropagation();
                        void say(v.reading);
                      }}
                    >
                      <span className="jp" lang="ja">
                        {v.word}
                      </span>
                      <span className="reading-sm" lang="ja">
                        {v.reading !== v.word ? v.reading : ''}
                      </span>
                      <span className="gloss">{v.meaning}</span>
                      {!known.words.has(w) && <span className="badge new">New</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <a
              className="faint"
              href={`https://tatoeba.org/en/sentences/show/${sentence.i}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              Tatoeba #{sentence.i} · CC BY 2.0 FR
            </a>
          </div>
        ) : (
          <div className="faint hint">Tap for the translation</div>
        )}
      </div>

      <div className="study-footer">
        {revealed ? (
          <button className="btn primary block" onClick={() => void next()}>
            {index + 1 >= reading.length ? 'Finish' : 'Next sentence'}
          </button>
        ) : (
          <button className="btn primary block" onClick={reveal}>
            Show translation
          </button>
        )}
      </div>
    </div>
  );
}
