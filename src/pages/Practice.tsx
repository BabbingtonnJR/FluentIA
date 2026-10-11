import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { loadSentences } from '../content/packs';
import type { Pack, Sentence } from '../content/types';
import { db } from '../db/db';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { rankBy, searcher } from '../lang/search';
import { loadLocal, saveLocal } from '../lib/local';
import { DAY } from '../lib/time';
import { generatePractice, PRACTICE_TITLES, type PracticeItem, type PracticeQuestion } from '../quiz/practice';
import { notifyLocalChange } from '../sync/events';
import { cardId, newCard, Rating } from '../srs/scheduler';
import { speak, stopSpeaking } from '../speech/tts';

const COUNTS = [10, 20, 30];
const SAVED = 'practice:items';
const RESULTS = 6;

const itemKey = (i: PracticeItem) => `${i.kind}:${i.id}`;

/** How an item reads in lists and chips. */
function itemLabel(pack: Pack, i: PracticeItem): { jp: string; en: string } {
  if (i.kind === 'grammar') {
    const g = pack.grammarById.get(i.id);
    return { jp: g?.pattern ?? i.id, en: g ? `N${g.level} · ${g.meaning}` : '' };
  }
  if (i.kind === 'kanji') {
    const k = pack.kanjiById.get(i.id);
    return { jp: i.id, en: k ? `N${k.level} kanji · ${k.meanings.slice(0, 2).join(', ')}` : '' };
  }
  const v = pack.vocabById.get(i.id);
  return { jp: v?.word ?? i.id, en: v ? `N${v.level} · ${v.reading !== v.word ? `${v.reading} · ` : ''}${v.meaning}` : '' };
}

/**
 * A drill built from exactly what the learner picks: grammar points, words and kanji (say,
 * ように, のように and ために before a test). Wrong options come from the other picks, so the
 * drill is about telling them apart.
 */
export function Practice() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [items, setItems] = useState<PracticeItem[]>(() => loadLocal<PracticeItem[]>(SAVED) ?? []);
  const [count, setCount] = useState(20);
  const [query, setQuery] = useState('');
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [wrong, setWrong] = useState<PracticeQuestion[]>([]);
  const [added, setAdded] = useState<number | null>(null);

  useEffect(() => {
    loadSentences(pack.manifest.id).then(setSentences, () => setSentences([]));
    return () => stopSpeaking();
  }, [pack]);
  useEffect(() => saveLocal(SAVED, items), [items]);

  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  const search = useMemo(() => searcher(query), [query]);
  const results = useMemo(() => {
    if (!search.q) return [];
    const chosen = new Set(items.map(itemKey));
    const top = <T,>(list: T[], rank: (t: T) => number, toItem: (t: T) => PracticeItem) =>
      rankBy(list, search.q, rank)
        .map(toItem)
        .filter((x) => !chosen.has(itemKey(x)))
        .slice(0, RESULTS);
    return [
      ...top(pack.grammar, search.grammar, (g) => ({ kind: 'grammar' as const, id: g.id })),
      ...top(pack.vocab, search.vocab, (v) => ({ kind: 'vocab' as const, id: v.id })),
      ...top(pack.kanji, search.kanji, (k) => ({ kind: 'kanji' as const, id: k.id })),
    ];
  }, [pack, search, items]);

  const add = (x: PracticeItem) => setItems((s) => [...s, x]);
  const remove = (x: PracticeItem) => setItems((s) => s.filter((y) => itemKey(y) !== itemKey(x)));

  /** Grammar, words and kanji answered "Again" in reviews over the last two weeks. */
  async function addForgotten() {
    const lang = pack.manifest.id;
    const since = Date.now() - 14 * DAY;
    const again = (await db.reviews.where('[lang+reviewedAt]').between([lang, since], [lang, Infinity]).toArray()).filter((r) => r.rating === Rating.Again);
    const cards = await db.cards.bulkGet([...new Set(again.map((r) => r.cardId))]);
    const chosen = new Set(items.map(itemKey));
    const found = cards.flatMap((c): PracticeItem[] => (c && c.kind !== 'custom' ? [{ kind: c.kind, id: c.itemId }] : [])).filter((x) => !chosen.has(itemKey(x)));
    setItems((s) => [...s, ...new Map(found.map((x) => [itemKey(x), x])).values()]);
  }

  function start(from: PracticeItem[] = items) {
    if (!sentences) return;
    setQuestions(generatePractice({ pack, sentences, items: from, count }));
    setI(0);
    setPicked(null);
    setWrong([]);
    setAdded(null);
  }

  const q = questions?.[i];

  function pick(n: number) {
    if (!q || picked !== null) return;
    setPicked(n);
    if (n !== q.answer) setWrong((w) => [...w, q]);
    if (q.speak) void say(q.speak);
  }

  function next() {
    if (!questions) return;
    if (i + 1 >= questions.length) {
      void logActivity(pack.manifest.id, 'practice', { score: questions.length - wrong.length, total: questions.length }, settings);
    }
    setI(i + 1);
    setPicked(null);
  }

  /** Puts the missed items into the study queue now (those not studied yet). */
  async function study(missed: PracticeItem[]) {
    const lang = pack.manifest.id;
    const now = Date.now();
    const refs = missed.map((x) => ({
      lang,
      kind: x.kind,
      direction: 'recognition' as const,
      itemId: x.id,
      level: (x.kind === 'grammar' ? pack.grammarById.get(x.id)?.level : x.kind === 'kanji' ? pack.kanjiById.get(x.id)?.level : pack.vocabById.get(x.id)?.level) ?? 0,
    }));
    const existing = await db.cards.bulkGet(refs.map((r) => cardId(lang, r.kind, r.direction, r.itemId)));
    const fresh = refs.filter((_, n) => !existing[n] || existing[n]!.deleted).map((r) => newCard(r, now));
    await db.cards.bulkPut(fresh);
    notifyLocalChange();
    setAdded(fresh.length);
  }

  const topbar = (
    <div className="topbar">
      <button className="icon-btn" onClick={() => (questions ? setQuestions(null) : navigate('/'))} aria-label={questions ? 'Back to the picks' : 'Close'}>
        <Icon name="close" />
      </button>
      {questions ? (
        <>
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${(i / Math.max(questions.length, 1)) * 100}%` }} />
          </div>
          <span className="faint">
            {Math.min(i + 1, questions.length)}/{questions.length}
          </span>
        </>
      ) : (
        <h2 className="wordle-title">Practice</h2>
      )}
    </div>
  );

  // --- Picking ---------------------------------------------------------------------------
  if (!questions) {
    return (
      <div className="stack">
        {topbar}
        <p className="faint" style={{ margin: 0 }}>
          Pick the grammar, words and kanji you want to drill, for example ように, のように and ために before a test. The wrong answers come
          from your other picks, so you learn to tell them apart.
        </p>

        <input
          className="input"
          type="search"
          placeholder="Search: youni, ように, so that, 会う…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search grammar, words and kanji"
        />
        {results.length > 0 && (
          <div className="list">
            {results.map((x) => {
              const l = itemLabel(pack, x);
              return (
                <button key={itemKey(x)} className="list-item practice-result" onClick={() => add(x)}>
                  <span className="term" lang="ja">
                    {l.jp}
                  </span>
                  <span className="gloss">{l.en}</span>
                  <span className="practice-add" aria-hidden="true">
                    +
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {search.q && !results.length && <div className="faint">No matches.</div>}

        <div className="spread">
          <div className="section-title" style={{ margin: 0 }}>
            Your picks · {items.length}
          </div>
          {items.length > 0 && (
            <button className="btn ghost small" onClick={() => setItems([])}>
              Clear
            </button>
          )}
        </div>
        {items.length ? (
          <div className="chips">
            {items.map((x) => (
              <button key={itemKey(x)} className="chip on" onClick={() => remove(x)} aria-label={`Remove ${itemLabel(pack, x).jp}`}>
                <span lang="ja">{itemLabel(pack, x).jp}</span> ×
              </button>
            ))}
          </div>
        ) : (
          <div className="faint">Nothing picked yet. Search above, or start from what you forgot lately.</div>
        )}
        <button className="btn block" onClick={() => void addForgotten()}>
          Add what I forgot in the last 2 weeks
        </button>

        <div className="field">
          <span className="label">Questions</span>
          <div className="segmented" role="group">
            {COUNTS.map((n) => (
              <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary block" disabled={!items.length || !sentences} onClick={() => start()}>
          Start
        </button>
      </div>
    );
  }

  // --- Results ----------------------------------------------------------------------------
  if (!q) {
    const total = questions.length;
    const score = total - wrong.length;
    const pct = total ? Math.round((score / total) * 100) : 0;
    const missed = [...new Map(wrong.map((w) => [itemKey(w.item), w.item])).values()];
    return (
      <div className="stack">
        {pct >= 50 && <Petals count={pct >= 80 ? 28 : 14} />}
        <div className="empty">
          <span className="jp stamp">{pct >= 80 ? '素晴らしい' : pct >= 50 ? 'いいね' : '頑張って'}</span>
          <h2 style={{ margin: '0 0 8px' }}>
            {score} / {total}
          </h2>
        </div>
        {missed.length > 0 && (
          <>
            <div className="section-title">To go over</div>
            <div className="list">
              {missed.map((x) => {
                const l = itemLabel(pack, x);
                const to = x.kind === 'grammar' ? `/grammar/${encodeURIComponent(x.id)}` : x.kind === 'kanji' ? `/kanji/${encodeURIComponent(x.id)}` : null;
                const body = (
                  <>
                    <span className="term" lang="ja">
                      {l.jp}
                    </span>
                    <span className="gloss">{l.en}</span>
                  </>
                );
                return to ? (
                  <Link key={itemKey(x)} to={to} className="list-item">
                    {body}
                  </Link>
                ) : (
                  <div key={itemKey(x)} className="list-item">
                    {body}
                  </div>
                );
              })}
            </div>
            <button className="btn primary block" onClick={() => start(missed)}>
              Drill the mistakes
            </button>
            {added === null ? (
              <button className="btn block" onClick={() => void study(missed)}>
                Add the mistakes to my study
              </button>
            ) : (
              <div className="notice">{added ? `${added} added: they come up in your next study session.` : 'They are already in your study.'}</div>
            )}
          </>
        )}
        <button className={`btn block${missed.length ? '' : ' primary'}`} onClick={() => start()}>
          Again with all my picks
        </button>
        <button className="btn ghost block" onClick={() => setQuestions(null)}>
          Change the picks
        </button>
      </div>
    );
  }

  // --- A question -------------------------------------------------------------------------
  return (
    <div className="stack">
      {topbar}
      <div key={`q${i}`} className="card center stack question-card" style={{ padding: '24px 16px' }}>
        <div className="faint">{PRACTICE_TITLES[q.type]}</div>
        {q.sentence ? (
          <>
            <p className="sentence" lang="ja" style={{ margin: 0 }}>
              <Ruby markup={q.sentence.markup} cloze={q.sentence.mark} blank={picked === null} mode={settings.furigana === 'none' ? 'none' : 'all'} />
            </p>
            {picked !== null && <div className="muted">{q.sentence.english}</div>}
          </>
        ) : (
          <div className={q.type === 'kanji-meaning' ? 'prompt-kanji' : 'prompt-jp'} lang="ja">
            {q.text}
          </div>
        )}
      </div>

      <div key={`o${i}`} className={`options${picked !== null ? ' answered' : ''}`}>
        {q.options.map((o, n) => {
          const state = picked === null ? '' : n === q.answer ? ' correct' : n === picked ? ' wrong' : '';
          return (
            <button
              key={o}
              className={`option${q.optionsJp ? ' jp' : ''}${state}`}
              style={{ '--i': n } as CSSProperties}
              lang={q.optionsJp ? 'ja' : 'en'}
              onClick={() => pick(n)}
            >
              {o}
              {picked !== null && <span className="option-note">{q.notes[n]}</span>}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <div className="row rise-in" style={{ gap: 8 }}>
          {q.speak && (
            <button className="icon-btn" onClick={() => void say(q.speak!)} aria-label="Play audio">
              <Icon name="speaker" />
            </button>
          )}
          {q.item.kind === 'grammar' && (
            <Link to={`/grammar/${encodeURIComponent(q.item.id)}`} className="faint">
              Notes on {pack.grammarById.get(q.item.id)?.pattern} →
            </Link>
          )}
          <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={next}>
            {i + 1 >= questions.length ? 'See results' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}
