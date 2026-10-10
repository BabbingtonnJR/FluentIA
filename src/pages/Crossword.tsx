import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { KanaKeyboard } from '../components/KanaKeyboard';
import { Petals } from '../components/Petals';
import { logActivity } from '../db/repo';
import { clueText, crosswordScore, crosswordWords, generateCrossword, wordCells, type Direction, type PlacedWord } from '../games/crossword';
import { modifyLast, tiles, typingKana } from '../games/wordle';
import { usePack, useSettings } from '../hooks';
import { loadLocal, saveLocal } from '../lib/local';
import { dayKey } from '../lib/time';
import { seededRandom } from '../reading/select';
import { speak, stopSpeaking } from '../speech/tts';

interface SavedGame {
  /** Kana typed per cell, keyed "row,col". */
  entries: Record<string, string>;
  /** Cells whose answer was revealed. */
  revealed: string[];
  /** Words (by index) whose kanji was shown. */
  kanji: number[];
  logged: boolean;
}
const EMPTY: SavedGame = { entries: {}, revealed: [], kanji: [], logged: false };
const cellKey = (r: number, c: number) => `${r},${c}`;
const DIR_LABEL: Record<Direction, string> = { across: 'Across', down: 'Down' };

export function Crossword() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const levels = pack.manifest.levels.map((l) => l.id);
  const [level, setLevel] = useState(() => {
    const saved = loadLocal<number>('crossword:level');
    return saved !== null && levels.includes(saved) ? saved : Math.max(...levels); // N5 first: easiest words
  });
  const [mode, setMode] = useState<'daily' | 'free'>('daily');
  const [freeRound, setFreeRound] = useState(0);

  const day = dayKey(Date.now(), settings.dayStartHour);
  const puzzle = useMemo(
    () => generateCrossword(crosswordWords(pack, level), mode === 'daily' ? seededRandom(`crossword:${level}:${day}`) : Math.random),
    [pack, level, day, mode, freeRound],
  );
  const storeKey = mode === 'daily' ? `crossword:${day}:${level}` : null;

  // One game per puzzle, read from storage during render so it is never overwritten by an empty one.
  const gameKey = storeKey ?? `free:${freeRound}`;
  const fresh = () => ({ key: gameKey, ...((storeKey && loadLocal<SavedGame>(storeKey)) || EMPTY) });
  const [game, setGame] = useState(fresh);
  const [sel, setSel] = useState<{ row: number; col: number; dir: Direction } | null>(null);
  const [lastCell, setLastCell] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState('');
  let active = game;
  if (game.key !== gameKey) {
    active = fresh();
    setGame(active);
    setSel(null);
    setChecked(false);
  }
  const update = (patch: Partial<SavedGame>) => {
    const next = { ...active, ...patch };
    setGame(next);
    if (storeKey) saveLocal(storeKey, { entries: next.entries, revealed: next.revealed, kanji: next.kanji, logged: next.logged } satisfies SavedGame);
  };

  useEffect(() => () => stopSpeaking(), []);

  const words = puzzle?.words ?? [];
  const isRight = (w: PlacedWord) => wordCells(w).every(([r, c], i) => active.entries[cellKey(r, c)] === w.kana[i]);
  const solved = words.length > 0 && words.every(isRight);

  useEffect(() => {
    if (!puzzle || !solved || active.logged) return;
    update({ logged: true });
    void logActivity(pack.manifest.id, 'crossword', { score: crosswordScore(words.length, active.revealed.length), total: words.length * 2 }, settings);
  }, [solved, active.logged, puzzle]); // the rest is read at the moment the puzzle is solved

  if (!puzzle) return null;

  // The selected word: the one through the selected cell in the selected direction.
  const start = sel ?? { row: words[0].row, col: words[0].col, dir: words[0].dir };
  const wordsAt = (r: number, c: number) => words.filter((w) => wordCells(w).some(([wr, wc]) => wr === r && wc === c));
  const current = wordsAt(start.row, start.col).find((w) => w.dir === start.dir) ?? wordsAt(start.row, start.col)[0] ?? words[0];
  const currentCells = wordCells(current);
  const cursor = sel && currentCells.some(([r, c]) => r === sel.row && c === sel.col) ? [sel.row, sel.col] : currentCells[0];
  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  function tap(r: number, c: number) {
    const here = wordsAt(r, c);
    if (!here.length) return;
    // Tapping the selected cell again switches between across and down.
    const sameCell = cursor[0] === r && cursor[1] === c;
    const w = sameCell ? (here.find((x) => x.dir !== current.dir) ?? current) : (here.find((x) => x.dir === current.dir) ?? here[0]);
    setSel({ row: r, col: c, dir: w.dir });
  }

  function selectWord(w: PlacedWord) {
    const firstEmpty = wordCells(w).find(([r, c]) => !active.entries[cellKey(r, c)]) ?? wordCells(w)[0];
    setSel({ row: firstEmpty[0], col: firstEmpty[1], dir: w.dir });
  }

  /** Writes kana into the selected word from the cursor on, skipping revealed cells. */
  function write(kana: string[]) {
    if (!kana.length) return;
    const entries = { ...active.entries };
    let i = currentCells.findIndex(([r, c]) => r === cursor[0] && c === cursor[1]);
    let last: string | null = null;
    for (const k of kana) {
      while (i < currentCells.length && active.revealed.includes(cellKey(...currentCells[i]))) i++;
      if (i >= currentCells.length) break;
      last = cellKey(...currentCells[i]);
      entries[last] = k;
      i++;
    }
    update({ entries });
    setLastCell(last);
    setChecked(false);
    // A filled word moves on to the next one with gaps, so typing can flow through the puzzle.
    const isFull = (w: PlacedWord) => wordCells(w).every(([r, c]) => entries[cellKey(r, c)]);
    const at = words.indexOf(current);
    const nextWord = isFull(current) ? [...words.slice(at + 1), ...words.slice(0, at)].find((w) => !isFull(w)) : undefined;
    if (nextWord) {
      const [r, c] = wordCells(nextWord).find(([wr, wc]) => !entries[cellKey(wr, wc)])!;
      setSel({ row: r, col: c, dir: nextWord.dir });
      setLastCell(null);
      return;
    }
    const next = currentCells[Math.min(i, currentCells.length - 1)];
    setSel({ row: next[0], col: next[1], dir: current.dir });
  }

  /** ゛ ゜ 小 change the kana just typed (or the one under the cursor). */
  function modify(mod: Parameters<typeof modifyLast>[1]) {
    const target = lastCell ?? cellKey(cursor[0], cursor[1]);
    const value = active.entries[target];
    if (!value || active.revealed.includes(target)) return;
    update({ entries: { ...active.entries, [target]: modifyLast(value, mod) } });
  }

  function backspace() {
    if (typed) {
      setTyped(typed.slice(0, -1));
      return;
    }
    const entries = { ...active.entries };
    let i = currentCells.findIndex(([r, c]) => r === cursor[0] && c === cursor[1]);
    // On an empty cell, delete the one before it, as in a text field.
    if (!entries[cellKey(...currentCells[i])] && i > 0) i--;
    const k = cellKey(...currentCells[i]);
    if (!active.revealed.includes(k)) delete entries[k];
    update({ entries });
    setLastCell(null);
    setChecked(false);
    setSel({ row: currentCells[i][0], col: currentCells[i][1], dir: current.dir });
  }

  function onTyping(raw: string) {
    const { kana, pending } = typingKana(raw);
    write(tiles(kana));
    setTyped(pending);
  }

  function revealCell() {
    const k = cellKey(cursor[0], cursor[1]);
    const answer = puzzle!.cells[cursor[0]][cursor[1]]!;
    update({ entries: { ...active.entries, [k]: answer }, revealed: active.revealed.includes(k) ? active.revealed : [...active.revealed, k] });
    setChecked(false);
  }

  function newPuzzle() {
    setMode('free');
    setFreeRound((r) => r + 1);
  }

  const wordIndex = words.indexOf(current);
  const showKanji = active.kanji.includes(wordIndex);
  const hasKanji = current.item.word !== current.item.reading;
  // Fit the grid to the screen: width, and height left over for the clue and kana keyboard.
  const cellSize = `max(26px, min(38px, calc((100vw - 32px) / ${puzzle.width} - 3px), calc((100svh - 500px) / ${puzzle.height} - 3px)))`;

  return (
    <div className="stack crossword">
      {solved && <Petals count={22} />}
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Close game">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title">
          <span lang="ja">クロスワード</span>
          <span className="faint"> · Crossword</span>
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
                saveLocal('crossword:level', l.id);
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
          <button className={`chip${mode === 'free' ? ' on' : ''}`} onClick={newPuzzle}>
            New puzzle
          </button>
        </div>
      </div>

      <div className="cw-grid" lang="ja" style={{ gridTemplateColumns: `repeat(${puzzle.width}, ${cellSize})`, gridAutoRows: cellSize }}>
        {puzzle.cells.flatMap((row, r) =>
          row.map((answer, c) => {
            const k = cellKey(r, c);
            if (!answer) return <div key={k} className="cw-block" />;
            const value = active.entries[k];
            const number = words.find((w) => w.row === r && w.col === c)?.number;
            const inWord = currentCells.some(([wr, wc]) => wr === r && wc === c);
            const isCursor = cursor[0] === r && cursor[1] === c;
            const state = active.revealed.includes(k) ? ' revealed' : checked && value ? (value === answer ? ' right' : ' wrong') : '';
            return (
              <button
                key={k}
                type="button"
                className={`cw-cell${solved ? ' solved' : `${inWord ? ' in-word' : ''}${isCursor ? ' cursor' : ''}`}${state}`}
                style={{ '--d': r + c } as CSSProperties}
                onClick={() => tap(r, c)}
                aria-label={`${number ? `${number}, ` : ''}row ${r + 1}, column ${c + 1}${value ? `: ${value}` : ''}`}
              >
                {number && <span className="cw-number">{number}</span>}
                {value}
              </button>
            );
          }),
        )}
      </div>

      {solved ? (
        <>
          <div className="empty" style={{ padding: '4px 0' }}>
            <span className="jp stamp">完成</span>
            <p>Solved{active.revealed.length ? ` with ${active.revealed.length} revealed kana` : ' with no reveals'}! Tap a word to hear it.</p>
          </div>
          <div className="list">
            {words.map((w) => (
              <button key={`${w.number}${w.dir}`} className="list-item" onClick={() => void say(w.item.reading)}>
                <span className="term" lang="ja">
                  {w.item.word !== w.item.reading ? (
                    <ruby>
                      {w.item.word}
                      <rt>{w.item.reading}</rt>
                    </ruby>
                  ) : (
                    w.item.word
                  )}
                </span>
                <span className="gloss">{w.item.meaning}</span>
              </button>
            ))}
          </div>
          <button className="btn primary block" onClick={newPuzzle}>
            New puzzle
          </button>
        </>
      ) : (
        <>
          <div className="cw-clue card">
            <div className="cw-clue-head">
              <span className="faint">
                {current.number} {DIR_LABEL[current.dir]} · {current.kana.length} kana
              </span>
              <div className="cw-clue-actions">
              <button className="chip" disabled={showKanji || !hasKanji} onClick={() => update({ kanji: [...active.kanji, wordIndex] })}>
                {hasKanji ? 'Kanji' : 'No kanji'}
              </button>
              <button className="chip" onClick={revealCell}>
                Reveal
              </button>
                <button className={`chip${checked ? ' on' : ''}`} onClick={() => setChecked(!checked)}>
                  Check
                </button>
              </div>
            </div>
            <strong>
              {clueText(current.item.meaning)}
              {showKanji && (
                <span className="jp cw-kanji" lang="ja">
                  {current.item.word}
                </span>
              )}
            </strong>
          </div>

          <input
            className="input cw-type"
            value={typed}
            onChange={(e) => onTyping(e.target.value)}
            placeholder="Type romaji or kana into the word"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            aria-label="Type into the selected word"
          />
          <KanaKeyboard onKana={(k) => write([k])} onModifier={modify} onBackspace={backspace} />

          <div className="cw-clues">
            {(['across', 'down'] as const).map((dir) => (
              <div key={dir}>
                <div className="section-title">{DIR_LABEL[dir]}</div>
                {words
                  .filter((w) => w.dir === dir)
                  .map((w) => (
                    <button key={w.number} className={`cw-clue-item${w === current ? ' on' : ''}${isRight(w) ? ' done' : ''}`} onClick={() => selectWord(w)}>
                      <b>{w.number}</b> {clueText(w.item.meaning)} <span className="faint">({w.kana.length})</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
