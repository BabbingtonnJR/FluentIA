import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import type { VocabItem } from '../content/types';
import { db } from '../db/db';
import { kanaQuery, matchRank, toHiragana } from '../lang/romaji';
import type { CardRecord } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { speak } from '../speech/tts';
import { cardStatus, type CardStatus } from '../stats/stats';

const PAGE = 80;
const TABS = ['vocab', 'kanji', 'grammar'] as const;
type Tab = (typeof TABS)[number];
const STATUS_LABEL: Record<CardStatus, string> = {
  unseen: 'Not studied',
  learning: 'Learning',
  young: 'Young',
  mature: 'Mature',
};

/** The better of several match ranks (lower is better, -1 is no match). */
function best(...ranks: number[]): number {
  return ranks.reduce((b, r) => (r >= 0 && (b < 0 || r < b) ? r : b), -1);
}

/** English glosses: a whole word or phrase between separators beats a substring. */
function englishRank(meaning: string, q: string): number {
  const m = meaning.toLowerCase();
  if (!m.includes(q)) return -1;
  const parts = m.split(/[;,()]/).map((p) => p.trim().replace(/^to /, ''));
  if (parts.includes(q) || parts.includes(q.replace(/^to /, ''))) return 0;
  return new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(m) ? 1 : 2;
}

const readingsOf = (reading: string) => reading.split(/[;、,]/).map((r) => toHiragana(r.replace(/[～~\s]/g, '')));

/** Filters to matches and orders them best match first, keeping list order within a rank. */
function rankBy<T>(items: T[], q: string, rank: (t: T) => number): T[] {
  if (!q) return items;
  return items
    .map((t, i) => ({ t, i, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

export function Library() {
  const pack = usePack();
  const settings = useSettings();
  const lang = pack.manifest.id;
  // The tab lives in the URL so "back" from a grammar or kanji page returns to it.
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t === params.get('tab')) ?? 'vocab';
  const setTab = (t: Tab) => setParams(t === 'vocab' ? {} : { tab: t }, { replace: true });
  const [level, setLevel] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const cards = useLiveQuery(
    async () => {
      const all = await db.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).toArray();
      const map = new Map<string, CardRecord>();
      for (const c of all) if (c.direction === 'recognition') map.set(`${c.kind}:${c.itemId}`, c);
      return map;
    },
    [lang],
    new Map<string, CardRecord>(),
  );

  const q = query.trim().toLowerCase();
  // "matsu" also searches readings as まつ, and katakana queries match hiragana readings.
  const kq = useMemo(() => kanaQuery(q), [q]);
  // A half-typed romaji match ranks after English ones, so "wait" lists 待つ before ワイン.
  const kanaRank = (texts: string[]) => {
    if (!kq) return -1;
    const r = best(...texts.map((t) => matchRank(t, kq.kana)));
    return r >= 0 && kq.partial ? r + 3 : r;
  };
  const vocab = useMemo(
    () =>
      rankBy(
        pack.vocab.filter((v) => level === null || v.level === level),
        q,
        (v) => best(matchRank(v.word, q), kanaRank(readingsOf(v.reading)), englishRank(v.meaning, q)),
      ),
    [pack, level, q, kq],
  );
  const kanji = useMemo(
    () =>
      rankBy(
        pack.kanji.filter((k) => level === null || k.level === level),
        q,
        (k) =>
          best(
            k.id === q ? 0 : -1,
            kanaRank([...k.on, ...k.kun].map((r) => toHiragana(r.replace(/[.-]/g, '')))),
            englishRank(k.meanings.join('; '), q),
          ),
      ),
    [pack, level, q, kq],
  );

  const grammar = useMemo(
    () =>
      pack.grammar.filter(
        (g) => (level === null || g.level === level) && (!q || g.pattern.includes(q) || g.meaning.toLowerCase().includes(q)),
      ),
    [pack, level, q],
  );

  const say = (v: VocabItem) => speak(v.reading, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          Library<span className="kanji-mark">辞書</span>
        </h1>
      </header>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'vocab'} className={tab === 'vocab' ? 'on' : ''} onClick={() => setTab('vocab')}>
          Words · {pack.vocab.length}
        </button>
        <button role="tab" aria-selected={tab === 'kanji'} className={tab === 'kanji' ? 'on' : ''} onClick={() => setTab('kanji')}>
          Kanji · {pack.kanji.length}
        </button>
        {pack.grammar.length > 0 && (
          <button role="tab" aria-selected={tab === 'grammar'} className={tab === 'grammar' ? 'on' : ''} onClick={() => setTab('grammar')}>
            Grammar · {pack.grammar.length}
          </button>
        )}
      </div>

      <input
        className="input"
        type="search"
        placeholder="Search Japanese, romaji (matsu) or English"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
        aria-label="Search"
      />

      <div className="chips">
        <button className={`chip${level === null ? ' on' : ''}`} onClick={() => setLevel(null)}>
          All
        </button>
        {pack.manifest.levels.map((l) => (
          <button key={l.id} className={`chip${level === l.id ? ' on' : ''}`} onClick={() => setLevel(l.id)}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="legend">
        {(['learning', 'young', 'mature'] as const).map((s) => (
          <span key={s} style={{ '--c': `var(--${s})` } as CSSProperties}>
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {tab === 'vocab' ? (
        <>
          <div className="list">
            {vocab.slice(0, limit).map((v) => {
              const status = cardStatus(cards.get(`vocab:${v.id}`));
              const isOpen = open === v.id;
              return (
                <div key={v.id}>
                  <button className="list-item" onClick={() => setOpen(isOpen ? null : v.id)} aria-expanded={isOpen}>
                    <span className={`dot ${status}`} title={STATUS_LABEL[status]} />
                    <span className="term" lang="ja">
                      {v.word}
                    </span>
                    <span className="gloss">{v.meaning}</span>
                  </button>
                  {isOpen && (
                    <div className="row" style={{ padding: '0 14px 14px', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div className="reading" lang="ja">
                          {v.reading}
                        </div>
                        <div>{v.meaning}</div>
                        <div className="faint">
                          N{v.level} · {STATUS_LABEL[status]}
                        </div>
                        <div className="chips" style={{ marginTop: 8 }}>
                          {[...new Set(v.word)]
                            .filter((c) => pack.kanjiById.has(c))
                            .map((c) => (
                              <Link key={c} className="chip jp" to={`/kanji/${encodeURIComponent(c)}`} lang="ja">
                                {c}
                              </Link>
                            ))}
                        </div>
                      </div>
                      <button className="icon-btn" onClick={() => void say(v)} aria-label="Play audio">
                        <Icon name="speaker" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {!vocab.length && <div className="empty">No matches.</div>}
          </div>
          {vocab.length > limit && (
            <button className="btn block" onClick={() => setLimit(limit + PAGE)}>
              Show more ({vocab.length - limit} left)
            </button>
          )}
        </>
      ) : tab === 'grammar' ? (
        <div className="list">
          {grammar.map((g) => {
            const status = cardStatus(cards.get(`grammar:${g.id}`));
            return (
              <Link key={g.id} className="list-item" to={`/grammar/${encodeURIComponent(g.id)}`}>
                <span className={`dot ${status}`} title={STATUS_LABEL[status]} />
                <span className="term" lang="ja">
                  {g.pattern}
                </span>
                <span className="gloss">{g.meaning}</span>
              </Link>
            );
          })}
          {!grammar.length && <div className="empty">No matches.</div>}
        </div>
      ) : (
        <div className="kanji-grid">
          {kanji.map((k) => {
            const status = cardStatus(cards.get(`kanji:${k.id}`));
            return (
              <Link key={k.id} className="kanji-tile" to={`/kanji/${encodeURIComponent(k.id)}`} lang="ja" title={k.meanings[0]}>
                {k.id}
                {status !== 'unseen' && <span className={`dot ${status}`} />}
              </Link>
            );
          })}
          {!kanji.length && <div className="empty">No matches.</div>}
        </div>
      )}
    </div>
  );
}
