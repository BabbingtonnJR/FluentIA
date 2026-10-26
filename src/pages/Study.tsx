import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { Examples, KanjiReadings, WordSenses } from '../components/WordSenses';
import { PitchReading, usePitch } from '../components/Pitch';
import { customFace, type SideMedia } from '../anki/convert';
import { cardFace } from '../content/faces';
import type { CardFace } from '../content/types';
import { db } from '../db/db';
import { answerCard, buildSession, markItemKnown, startCard } from '../db/repo';
import type { CardRecord, Direction, NoteRecord } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { afterMotion } from '../lib/motion';
import { formatInterval } from '../lib/time';
import { speak, speakWords, stopSpeaking } from '../speech/tts';
import { GRADE_LABELS, GRADES, previewIntervals, Rating, State, type Grade } from '../srs/scheduler';
import { REQUEUE_WITHIN_MS, requeuePosition, type QueueEntry } from '../srs/queue';
import { getContext, getMemo, isLeech, saveMemo, type MinedContext } from '../study/weak';
import { plainText } from '../reading/furigana';

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
  // Cards from imported decks: their content lives in a note, pictures and sounds as object URLs.
  const [custom, setCustom] = useState<CustomCard | null>(null);
  // Built-in cards: the sentence a word was mined from, and the learner's memory hook.
  const [extras, setExtras] = useState<{ context: MinedContext | null; memo: string }>({ context: null, memo: '' });
  const audio = useRef<HTMLAudioElement | null>(null);
  const pitch = usePitch(pack.manifest.id);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ reviewed: 0, learned: 0, again: 0 });
  // `seq` re-keys the card so each one plays its entrance; `leaving` holds the grade while it exits.
  const [seq, setSeq] = useState(0);
  const [leaving, setLeaving] = useState<Grade | 'skip' | null>(null);
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
      const note = rec?.kind === 'custom' ? await db.notes.get(rec.itemId) : undefined;
      const next = note && rec ? await loadCustom(note, rec.direction) : null;
      const item = rec && rec.kind !== 'custom' ? { kind: rec.kind, id: rec.itemId } : null;
      const more = item ? { context: await getContext(rec!.lang, item), memo: await getMemo(rec!.lang, item) } : { context: null, memo: '' };
      if (!alive) {
        next?.urls.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setCustom(next);
      setExtras(more);
      setCard(rec ?? null);
      if (next && settings.autoplay) playSounds(next.question.sounds);
      setRevealed(false);
      setLeaving(null);
      setSeq((n) => n + 1);
      shownAt.current = Date.now();
      if (!rec) setCursor((c) => c + 1); // card disappeared (e.g. deleted by sync); skip it
    };
    void load();
    return () => {
      alive = false;
    };
  }, [entry]);

  // Release the previous card's pictures and sounds.
  useEffect(() => () => custom?.urls.forEach((u) => URL.revokeObjectURL(u)), [custom]);

  /** Plays a card's own recordings one after another. */
  function playSounds(urls: string[]) {
    audio.current?.pause();
    const play = (i: number) => {
      if (i >= urls.length) return;
      const a = new Audio(urls[i]);
      audio.current = a;
      a.onended = () => play(i + 1);
      void a.play().catch(() => {});
    };
    play(0);
  }

  const stopAll = useCallback(() => {
    stopSpeaking();
    audio.current?.pause();
  }, []);
  useEffect(() => stopAll, [stopAll]);

  const face = !card ? null : card.kind === 'custom' ? (custom?.face ?? null) : cardFace(pack, card.kind, card.direction, card.itemId, card.reps);
  const say = useCallback(
    (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate }),
    [pack, settings.voiceURI, settings.speechRate],
  );
  /** The answer's audio: the deck's own recording if it has one, otherwise the synthetic voice. */
  const sayAnswer = useCallback(() => {
    if (custom?.answer.sounds.length) playSounds(custom.answer.sounds);
    else if (face?.audio) void speakWords(face.audio, face.speak, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
    else if (face?.speak) void say(face.speak);
  }, [custom, face, say]);

  const reveal = useCallback(() => {
    if (!face || revealed) return;
    setRevealed(true);
    if (settings.autoplay) sayAnswer();
  }, [face, revealed, settings.autoplay, sayAnswer]);

  const grade = useCallback(
    async (g: Grade) => {
      if (!card || !queue || busy.current) return;
      busy.current = true;
      stopAll();
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
      setLeaving(g);
      await afterMotion(200);
      setCursor((c) => c + 1);
      busy.current = false;
    },
    [card, queue, cursor, stopAll],
  );

  const alreadyKnown = useCallback(async () => {
    if (!entry || entry.type !== 'new' || busy.current) return;
    busy.current = true;
    await markItemKnown(entry.ref);
    setLeaving('skip');
    await afterMotion(200);
    setCursor((c) => c + 1);
    busy.current = false;
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
        {stats.reviewed + stats.learned > 0 && <Petals />}
        <div className="empty">
          <span className="jp stamp">{queue.length ? 'お疲れ様' : '完了'}</span>
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
  const rubyMode = settings.furigana === 'none' ? 'none' : 'all';

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

      <div
        key={seq}
        className={`card flashcard${leaving ? ` leaving ${leaving === 'skip' ? 'skip' : GRADE_CLASS[leaving]}` : ''}`}
        onClick={reveal} role="button" tabIndex={0} aria-label={revealed ? undefined : 'Show answer'}>
        <div className="row" style={{ gap: 6 }}>
          {isNew && <span className="badge new">New</span>}
          <span className="badge">
            {custom
              ? `${custom.deck}${card.direction === 'production' ? ' · Reverse' : ''}`
              : `${pack.manifest.levels.find((l) => l.id === card.level)?.label} · ${face.cloze ? 'Grammar' : isKanji ? 'Kanji' : card.direction === 'production' ? 'Say it in Japanese' : 'Word'}`}
          </span>
        </div>

        {face.cloze ? (
          <>
            <p className="sentence" lang="ja">
              <Ruby
                markup={face.cloze.example.r}
                cloze={face.cloze.example.c}
                blank={!revealed}
                mode={settings.furigana === 'none' ? 'none' : 'all'}
              />
            </p>
            <div className="muted">{face.cloze.example.e}</div>
          </>
        ) : (
          <div className={face.promptIsTarget ? (isKanji ? 'prompt-kanji' : 'prompt-jp') : 'prompt-en'} lang={face.promptIsTarget ? 'ja' : 'en'}>
            {face.prompt}
          </div>
        )}
        {extras.context && (face.promptIsTarget || revealed) && <MinedLine context={extras.context} word={face.promptIsTarget ? face.prompt : face.answer} revealed={revealed} mode={rubyMode} />}
        {custom && custom.question.images.length > 0 && <CardImages urls={custom.question.images} />}
        {custom && !face.prompt && (
          custom.question.sounds.length ? (
            <button
              className="icon-btn listen-prompt"
              onClick={(e) => {
                e.stopPropagation();
                playSounds(custom.question.sounds);
              }}
              aria-label="Play the question again"
            >
              <Icon name="speaker" />
            </button>
          ) : (
            !custom.question.images.length && <div className="faint">This card's audio is not on this device. Import the deck again here to get it.</div>
          )
        )}

        {revealed && face.cloze ? (
          <div className="answer">
            <div className="grammar-pattern" lang="ja">
              {face.cloze.pattern}
            </div>
            <div className="meaning">{face.meaning}</div>
            {!!face.alternatives?.length && (
              <div className="also-right">
                Also right here:{' '}
                <span className="jp" lang="ja">
                  {face.alternatives.join('、')}
                </span>
              </div>
            )}
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
            <Link to={`/grammar/${encodeURIComponent(card.itemId)}`} className="faint" onClick={(e) => e.stopPropagation()}>
              Grammar notes & examples →
            </Link>
          </div>
        ) : revealed ? (
          <div className="answer">
            {!face.promptIsTarget && (
              <div className="prompt-jp" lang="ja" style={{ fontSize: '2.4rem' }}>
                {face.answer}
              </div>
            )}
            {face.reading && (
              <div className="reading">
                {face.senses?.length === 1 ? <PitchReading reading={face.reading} phrases={pitch[face.senses[0].id]} /> : face.reading}
              </div>
            )}
            {/* With several readings, each reading's block below gives its own meaning. */}
            {face.promptIsTarget && !(face.senses && face.senses.length > 1) && <div className="meaning">{face.answer}</div>}
            {custom && custom.answer.images.length > 0 && <CardImages urls={custom.answer.images} />}
            {face.details?.map((d) => (
              <div key={d} className="muted jp" lang="ja">
                {d}
              </div>
            ))}
            {face.senses && <WordSenses senses={face.senses} mode={rubyMode} say={(t) => void say(t)} pitch={pitch} />}
            <KanjiReadings face={face} say={(t) => void say(t)} />
            {face.examples && <Examples examples={face.examples} mode={rubyMode} say={(t) => void say(t)} />}
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                sayAnswer();
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
          <div className="faint hint">Tap to reveal</div>
        )}
        {revealed && card.kind !== 'custom' && (
          <MemoBox
            key={card.id}
            leech={isLeech(card) ? card.lapses : 0}
            memo={extras.memo}
            onSave={(text) => {
              setExtras((x) => ({ ...x, memo: text }));
              void saveMemo(card.lang, { kind: card.kind as 'vocab' | 'kanji' | 'grammar', id: card.itemId }, text);
            }}
          />
        )}
      </div>

      <div className="study-footer">
        {revealed && intervals ? (
          <div className="grades">
            {GRADES.map((g, n) => (
              <button
                key={g}
                className={`grade ${GRADE_CLASS[g]}${leaving === g ? ' chosen' : ''}`}
                style={{ '--i': n } as CSSProperties}
                onClick={() => void grade(g)}
              >
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

/** A card from an imported deck, with its pictures and sounds ready to show and play. */
interface CustomCard {
  face: CardFace;
  deck: string;
  question: { images: string[]; sounds: string[] };
  answer: { images: string[]; sounds: string[] };
  /** Object URLs to release when the card goes. */
  urls: string[];
}

async function loadCustom(note: NoteRecord, direction: Direction): Promise<CustomCard> {
  const face = customFace(note, direction);
  const deck = await db.decks.get(note.deckId);
  const names = [...new Set([...face.question.images, ...face.question.sounds, ...face.answerMedia.images, ...face.answerMedia.sounds])];
  const files = await db.media.bulkGet(names);
  const url = new Map<string, string>();
  names.forEach((name, i) => {
    const file = files[i];
    if (file) url.set(name, URL.createObjectURL(file.blob));
  });
  // Media missing on this device (imported elsewhere) is simply left out.
  const side = (m: SideMedia) => ({ images: m.images.flatMap((n) => url.get(n) ?? []), sounds: m.sounds.flatMap((n) => url.get(n) ?? []) });
  return { face, deck: deck?.name ?? 'Your deck', question: side(face.question), answer: side(face.answerMedia), urls: [...url.values()] };
}

function CardImages({ urls }: { urls: string[] }) {
  return (
    <div className="card-images">
      {urls.map((u) => (
        <img key={u} src={u} alt="" />
      ))}
    </div>
  );
}

/** The sentence a word was mined from, the word marked; its translation once the card is turned. */
function MinedLine({ context, word, revealed, mode }: { context: MinedContext; word: string; revealed: boolean; mode: 'all' | 'none' }) {
  const plain = plainText(context.r);
  const at = plain.indexOf(word);
  return (
    <div className="mined-line">
      <p className="sentence" lang="ja">
        <Ruby markup={context.r} mode={mode} cloze={at >= 0 ? [at, at + word.length] : undefined} />
      </p>
      {revealed && (
        <div className="faint">
          {context.e}
          {context.source && (
            <>
              {context.e ? ' · ' : ''}from <i>{context.source}</i>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The learner's memory hook for an item. A leech (forgotten again and again) asks for one: more
 * reviews of the same card rarely help, a new angle does.
 */
function MemoBox({ leech, memo, onSave }: { leech: number; memo: string; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memo);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div className={`memo${leech ? ' leech' : ''}`} onClick={stop}>
      {leech > 0 && (
        <div className="memo-leech">
          <b>Tricky card</b> · forgotten {leech} times. {memo ? 'Your hook:' : 'Write a memory hook: a picture, a story, or what you confuse it with.'}
        </div>
      )}
      {editing ? (
        <form
          className="stack"
          style={{ gap: 6 }}
          onSubmit={(e) => {
            e.preventDefault();
            onSave(text);
            setEditing(false);
          }}
        >
          <textarea className="input" rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Memory hook" />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn small primary">Save</button>
            <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : memo ? (
        <button className="memo-text" onClick={() => setEditing(true)} aria-label="Edit memory hook">
          <span className="memo-label">Hook</span> {memo}
        </button>
      ) : (
        <button className={`btn small${leech ? ' primary' : ' ghost'}`} onClick={() => setEditing(true)}>
          {leech ? 'Write a memory hook' : '+ Memory hook'}
        </button>
      )}
    </div>
  );
}

