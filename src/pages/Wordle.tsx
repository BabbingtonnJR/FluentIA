import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { KanaKeyboard } from '../components/KanaKeyboard';
import { Petals } from '../components/Petals';
import { logActivity } from '../db/repo';
import { recordMistake } from '../study/weak';
import {
  dailyWord,
  keyMarks,
  MAX_GUESSES,
  modifyLast,
  scoreGuess,
  tiles,
  typingKana,
  validGuesses,
  WORD_LENGTH,
  wordleScore,
  wordleWords,
  type Mark,
  type WordleWord,
} from '../games/wordle';
import { usePack, useSettings } from '../hooks';
import { loadLocal, saveLocal } from '../lib/local';
import { dayKey } from '../lib/time';
import { speak, stopSpeaking } from '../speech/tts';

interface Hints {
  meaning: boolean;
  kanji: boolean;
  /** Positions whose kana was revealed. */
  kana: number[];
}
interface SavedGame {
  guesses: string[];
  hints: Hints;
  logged: boolean;
}
const NO_HINTS: Hints = { meaning: false, kanji: false, kana: [] };

// The daily game is kept per browser so leaving and coming back resumes it.
const load = loadLocal;
const save = saveLocal;

const SQUARE: Record<Mark, string> = { hit: '🟩', near: '🟨', miss: '⬜' };

export function Wordle() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const levels = pack.manifest.levels.map((l) => l.id);
  const [level, setLevel] = useState(() => {
    const saved = load<number>('wordle:level');
    return saved !== null && levels.includes(saved) ? saved : Math.max(...levels); // N5 first: easiest words
  });
  const [mode, setMode] = useState<'daily' | 'free'>('daily');
  const [freeRound, setFreeRound] = useState(0);

  const day = dayKey(Date.now(), settings.dayStartHour);
  const words = useMemo(() => wordleWords(pack, level), [pack, level]);
  const valid = useMemo(() => validGuesses(pack), [pack]);
  const target: WordleWord | undefined = useMemo(
    () => (mode === 'daily' ? dailyWord(words, day, level) : words[Math.floor(Math.random() * words.length)]),
    [words, day, level, mode, freeRound],
  );
  const storeKey = mode === 'daily' ? `wordle:${day}:${level}` : null;

  // One game per puzzle. Today's game is read from storage as soon as the puzzle changes (during
  // render, not in an effect), so it is never overwritten by an empty board first.
  const gameKey = storeKey ?? `free:${freeRound}:${target?.kana}`;
  const fresh = (): SavedGame & { key: string } => ({
    key: gameKey,
    ...((storeKey && load<SavedGame>(storeKey)) || { guesses: [], hints: NO_HINTS, logged: false }),
  });
  const [game, setGame] = useState(fresh);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  let active = game;
  if (game.key !== gameKey) {
    active = fresh();
    setGame(active);
    setTyped('');
    setMessage(null);
  }
  const { guesses, hints, logged } = active;
  const update = (patch: Partial<SavedGame>) => {
    const next = { ...active, ...patch };
    setGame(next);
    if (storeKey) save(storeKey, { guesses: next.guesses, hints: next.hints, logged: next.logged } satisfies SavedGame);
  };
  const setHints = (h: Hints) => update({ hints: h });

  useEffect(() => () => stopSpeaking(), []);

  const answer = target?.kana ?? '';
  const solved = guesses.includes(answer);
  const over = solved || guesses.length >= MAX_GUESSES;
  const hintCount = Number(hints.meaning) + Number(hints.kanji) + hints.kana.length;
  const say = () => target && speak(target.item.reading, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  // Log once, when the game ends.
  useEffect(() => {
    if (!target || !over || logged) return;
    update({ logged: true });
    void logActivity(pack.manifest.id, 'wordle', { score: wordleScore(solved, guesses.length, hintCount), total: MAX_GUESSES }, settings);
    if (!solved) void recordMistake(pack.manifest.id, { kind: 'vocab', id: target.item.id }, 'wordle');
    void say();
  }, [over, logged, target]); // the rest is read at the moment the game ends

  if (!target) return null;
  const marksByKey = keyMarks(guesses, answer);
  const { kana: current, pending } = typingKana(typed);

  function setTyping(raw: string) {
    const { kana, pending: rest } = typingKana(raw);
    const kept = tiles(kana).slice(0, WORD_LENGTH);
    setTyped(kept.join('') + (kept.length >= WORD_LENGTH ? '' : rest));
    setMessage(null);
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (over) return;
    // A final lone n is ん once the guess is sent.
    const guess = pending === 'n' ? current + 'ん' : current;
    if (tiles(guess).length !== WORD_LENGTH) {
      setMessage(`Use ${WORD_LENGTH} kana`);
      setShake((s) => s + 1);
      return;
    }
    if (!valid.has(guess)) {
      setMessage('Not in the word list');
      setShake((s) => s + 1);
      return;
    }
    update({ guesses: [...guesses, guess] });
    setTyped('');
  }

  function backspace() {
    if (pending) setTyped(current + pending.slice(0, -1));
    else setTyped(tiles(current).slice(0, -1).join(''));
    setMessage(null);
  }

  function revealKana() {
    const found = new Set(guesses.flatMap((g) => scoreGuess(g, answer).flatMap((m, i) => (m === 'hit' ? [i] : []))));
    const pos = tiles(answer).findIndex((_, i) => !found.has(i) && !hints.kana.includes(i));
    if (pos >= 0) setHints({ ...hints, kana: [...hints.kana, pos] });
  }

  function copyResult() {
    const grid = guesses.map((g) => scoreGuess(g, answer).map((m) => SQUARE[m]).join('')).join('\n');
    const hintText = hintCount ? ` · ${hintCount} hint${hintCount > 1 ? 's' : ''}` : '';
    const text = `Fluentia ワードル N${level} ${day} ${solved ? guesses.length : 'X'}/${MAX_GUESSES}${hintText}\n${grid}`;
    navigator.clipboard?.writeText(text).then(
      () => setMessage('Result copied'),
      () => setMessage('Could not copy'),
    );
  }

  function playFree() {
    setMode('free');
    setFreeRound((r) => r + 1);
  }

  const hasKanji = target.item.word !== target.item.reading;

  return (
    <div className="stack wordle">
      {solved && <Petals count={20} />}
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Close game">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title">
          <span lang="ja">ワードル</span>
          <span className="faint"> · Wordle</span>
        </h2>
      </div>

      <div className="wordle-controls">
        <div className="chips">
          {pack.manifest.levels.map((l) => (
            <button
              key={l.id}
              className={`chip${level === l.id ? ' on' : ''}`}
              onClick={() => {
                setLevel(l.id);
                save('wordle:level', l.id);
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="chips">
          <button className={`chip${mode === 'daily' ? ' on' : ''}`} onClick={() => setMode('daily')}>
            Daily
          </button>
          <button className={`chip${mode === 'free' ? ' on' : ''}`} onClick={playFree}>
            Free play
          </button>
        </div>
      </div>

      <div className="wordle-board" lang="ja" aria-label="Guesses">
        {Array.from({ length: MAX_GUESSES }, (_, r) => {
          const guess = guesses[r];
          const isCurrent = r === guesses.length && !over;
          const marks = guess ? scoreGuess(guess, answer) : null;
          const cells = guess ? tiles(guess) : isCurrent ? tiles(current) : [];
          return (
            // keyed by the shake count so a rejected guess replays the shake
            <div key={isCurrent ? `r${r}-${shake}` : `r${r}`} className={`wordle-row${isCurrent && shake ? ' shake' : ''}`}>
              {Array.from({ length: WORD_LENGTH }, (_, c) => {
                const k = cells[c];
                const hint = isCurrent && !k && hints.kana.includes(c) ? tiles(answer)[c] : null;
                const showPending = isCurrent && c === cells.length && pending;
                return (
                  <div
                    key={c}
                    className={`wordle-tile${marks ? ` ${marks[c]} flip` : k ? ' filled' : ''}${hint ? ' hint' : ''}`}
                    style={{ '--i': c } as CSSProperties}
                  >
                    {k ?? hint ?? (showPending ? <span className="pending">{pending}</span> : '')}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {message && (
        <div className="wordle-message" role="status">
          {message}
        </div>
      )}

      {over ? (
        <>
          <div className="card answer-detail rise-in">
            <div className="answer-word" lang="ja">
              {hasKanji ? (
                <ruby>
                  {target.item.word}
                  <rt>{target.item.reading}</rt>
                </ruby>
              ) : (
                target.item.word
              )}
            </div>
            <div className="answer-body">
              <strong>{solved ? (guesses.length <= 3 ? '素晴らしい!' : 'いいね!') : 'Not this time'}</strong>
              <div>{target.item.meaning}</div>
              <div className="faint">
                {solved ? guesses.length : 'X'}/{MAX_GUESSES}
                {hintCount > 0 && ` · ${hintCount} hint${hintCount > 1 ? 's' : ''}`}
              </div>
            </div>
            <button className="icon-btn" onClick={() => void say()} aria-label="Play audio">
              <Icon name="speaker" />
            </button>
          </div>
          <button className="btn primary block" onClick={copyResult}>
            Copy result
          </button>
          <button className="btn block" onClick={playFree}>
            {mode === 'daily' ? 'Free play · another word' : 'Another word'}
          </button>
          {mode === 'daily' && <p className="faint center">A new daily word every day.</p>}
        </>
      ) : (
        <>
          <div className="wordle-hints">
            <button className={`chip${hints.meaning ? ' on' : ''}`} disabled={hints.meaning} onClick={() => setHints({ ...hints, meaning: true })}>
              {hints.meaning ? target.item.meaning : 'Hint: meaning'}
            </button>
            <button
              className={`chip${hints.kanji ? ' on jp' : ''}`}
              disabled={hints.kanji || !hasKanji}
              onClick={() => setHints({ ...hints, kanji: true })}
              lang={hints.kanji ? 'ja' : undefined}
            >
              {hints.kanji ? target.item.word : hasKanji ? 'Hint: kanji' : 'No kanji'}
            </button>
            <button className="chip" disabled={hints.kana.length >= WORD_LENGTH - 1} onClick={revealKana}>
              Hint: one kana
            </button>
          </div>

          <form className="wordle-input" onSubmit={submit}>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyping(e.target.value)}
              placeholder="Type romaji or kana, e.g. neko"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="Type your guess"
            />
          </form>

          <KanaKeyboard
            marks={marksByKey}
            onKana={(k) => setTyping(current + k)}
            onModifier={(m) => setTyping(modifyLast(current, m))}
            onBackspace={backspace}
            onEnter={() => submit()}
          />
        </>
      )}
    </div>
  );
}
