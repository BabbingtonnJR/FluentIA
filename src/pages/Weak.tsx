import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import type { ItemKind } from '../content/types';
import { db } from '../db/db';
import type { MistakeSource } from '../db/types';
import { usePack } from '../hooks';
import { practiceLabel, type PracticeItem } from '../quiz/practice';
import { allMemos, leeches, LEECH_LAPSES, openMistakes, resolveMistakes, saveMemo } from '../study/weak';

const SOURCE_LABEL: Record<MistakeSource, string> = {
  quiz: 'quiz',
  mock: 'mock test',
  practice: 'practice',
  wordle: 'Wordle',
  passages: 'reading',
};

const detailLink = (kind: ItemKind, id: string) =>
  kind === 'grammar' ? `/grammar/${encodeURIComponent(id)}` : kind === 'kanji' ? `/kanji/${encodeURIComponent(id)}` : null;

/**
 * Weak spots (弱点): the mistake notebook (every wrong answer in quizzes, mock tests, drills and
 * games, until the item is answered right again) and the tricky cards that keep being forgotten,
 * each with the learner's own memory hook.
 */
export function Weak() {
  const pack = usePack();
  const lang = pack.manifest.id;
  const navigate = useNavigate();
  const [tab, setTab] = useState<'mistakes' | 'tricky'>('mistakes');

  const data = useLiveQuery(async () => {
    const cards = await db.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).toArray();
    return { mistakes: await openMistakes(lang), tricky: leeches(cards), memos: await allMemos(lang) };
  }, [lang]);
  if (!data) return null;

  const known = (x: PracticeItem) => (x.kind === 'grammar' ? pack.grammarById.has(x.id) : x.kind === 'kanji' ? pack.kanjiById.has(x.id) : pack.vocabById.has(x.id));
  const mistakes = data.mistakes.filter(known);
  const tricky = data.tricky.flatMap((c) => (c.kind === 'custom' ? [] : [{ kind: c.kind, id: c.itemId, lapses: c.lapses }])).filter(known);
  // One entry per item: recognition and production cards of a word share it.
  const trickyItems = [...new Map(tricky.map((t) => [`${t.kind}:${t.id}`, t])).values()];

  const drill = (items: PracticeItem[]) => navigate('/practice', { state: { items: items.slice(0, 40) } });

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <Icon name="back" />
        </button>
        <h2 className="wordle-title">
          Weak spots <span className="jp faint">弱点</span>
        </h2>
      </div>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'mistakes'} className={tab === 'mistakes' ? 'on' : ''} onClick={() => setTab('mistakes')}>
          Mistakes · {mistakes.length}
        </button>
        <button role="tab" aria-selected={tab === 'tricky'} className={tab === 'tricky' ? 'on' : ''} onClick={() => setTab('tricky')}>
          Tricky cards · {trickyItems.length}
        </button>
      </div>

      {tab === 'mistakes' ? (
        <>
          <p className="faint" style={{ margin: 0 }}>
            Every wrong answer in quizzes, mock tests, practice and Wordle lands here. An item leaves the list once you answer it right in a drill.
          </p>
          {mistakes.length ? (
            <>
              <button className="btn primary block" onClick={() => drill(mistakes)}>
                Drill my mistakes
              </button>
              <div className="list">
                {mistakes.map((m) => {
                  const l = practiceLabel(pack, m);
                  const to = detailLink(m.kind, m.id);
                  return (
                    <div key={`${m.kind}:${m.id}`} className="list-item weak-item">
                      <span className="term" lang="ja">
                        {to ? <Link to={to}>{l.jp}</Link> : l.jp}
                      </span>
                      <span className="gloss">
                        {l.en}
                        <span className="faint weak-meta">
                          {' '}
                          · missed {m.count}× in {m.sources.map((s) => SOURCE_LABEL[s]).join(', ')}
                          {m.picked.length > 0 && (
                            <>
                              {' '}
                              · you chose <span lang="ja">{m.picked.slice(0, 2).join('、')}</span>
                            </>
                          )}
                        </span>
                      </span>
                      <button className="btn ghost small" onClick={() => void resolveMistakes(lang, [m])} aria-label={`I've got ${l.jp} now`}>
                        <Icon name="check" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="empty">
              <span className="jp">無</span>
              No open mistakes. Take a quiz or a mock test and anything you miss shows up here.
            </div>
          )}
        </>
      ) : (
        <>
          <p className="faint" style={{ margin: 0 }}>
            Cards you have forgotten {LEECH_LAPSES} times or more. More of the same reviews rarely fixes them: write a hook (a picture, a story, what you
            mix it up with) and drill them side by side.
          </p>
          {trickyItems.length ? (
            <>
              <button className="btn primary block" onClick={() => drill(trickyItems)}>
                Drill the tricky cards
              </button>
              <div className="list">
                {trickyItems.map((t) => (
                  <TrickyRow key={`${t.kind}:${t.id}`} item={t} lapses={t.lapses} memo={data.memos.get(`${t.kind}:${t.id}`) ?? ''} lang={lang} />
                ))}
              </div>
            </>
          ) : (
            <div className="empty">
              <span className="jp">良</span>
              No tricky cards. A card shows up here after being forgotten {LEECH_LAPSES} times.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrickyRow({ item, lapses, memo, lang }: { item: PracticeItem; lapses: number; memo: string; lang: string }) {
  const pack = usePack();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memo);
  const l = practiceLabel(pack, item);
  const to = detailLink(item.kind, item.id);
  return (
    <div className="list-item weak-item tricky">
      <span className="term" lang="ja">
        {to ? <Link to={to}>{l.jp}</Link> : l.jp}
      </span>
      <span className="gloss">
        {l.en}
        <span className="faint weak-meta"> · forgotten {lapses}×</span>
        {editing ? (
          <form
            className="row"
            style={{ gap: 6, marginTop: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              void saveMemo(lang, item, text);
              setEditing(false);
            }}
          >
            <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Your memory hook" aria-label="Memory hook" />
            <button className="btn small primary">Save</button>
          </form>
        ) : (
          <button className="memo-text" onClick={() => setEditing(true)}>
            {memo ? (
              <>
                <span className="memo-label">Hook</span> {memo}
              </>
            ) : (
              '+ Write a memory hook'
            )}
          </button>
        )}
      </span>
    </div>
  );
}
