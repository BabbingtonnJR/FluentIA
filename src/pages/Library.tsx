import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { WordSenses } from '../components/WordSenses';
import { cardFace } from '../content/faces';
import { oneKanjiWord, primaryVocabId, studyVocab, vocabGroup, wordKey } from '../content/senses';
import type { VocabItem } from '../content/types';
import { db } from '../db/db';
import { rankBy, searcher } from '../lang/search';
import type { CardRecord } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { speak, speakWords } from '../speech/tts';
import { PitchReading, usePitch } from '../components/Pitch';
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
      // A word's card may be stored under another of its readings (see withoutDuplicateReadings).
      for (const c of all) {
        if (c.kind !== 'vocab' || c.direction !== 'recognition') continue;
        const key = `vocab:${primaryVocabId(pack, c.itemId)}`;
        if (!map.has(key)) map.set(key, c);
      }
      return map;
    },
    [lang],
    new Map<string, CardRecord>(),
  );

  // "matsu" also searches readings as まつ, "youni" finds 〜ように, katakana matches hiragana.
  const search = useMemo(() => searcher(query), [query]);
  const q = search.q;
  const vocab = useMemo(
    () =>
      rankBy(
        studyVocab(pack).filter((v) => level === null || v.level === level),
        q,
        // Any reading finds the word: とお finds 十.
        (v) => {
          const ranks = vocabGroup(pack, v.id).map((m) => search.vocab(m)).filter((r) => r >= 0);
          return ranks.length ? Math.min(...ranks) : -1;
        },
      ),
    [pack, level, q, search],
  );
  const kanji = useMemo(
    () =>
      rankBy(
        pack.kanji.filter((k) => level === null || k.level === level),
        q,
        search.kanji,
      ),
    [pack, level, q, search],
  );

  const grammar = useMemo(
    () =>
      rankBy(
        pack.grammar.filter((g) => level === null || g.level === level),
        q,
        search.grammar,
      ),
    [pack, level, q, search],
  );

  const sayText = (text: string) => void speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  const say = (v: VocabItem) => {
    const face = cardFace(pack, 'vocab', 'recognition', v.id);
    void speakWords(face?.audio ?? [], face?.speak ?? v.reading, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  };
  const pitch = usePitch(pack.manifest.id);

  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          Library<span className="kanji-mark">辞書</span>
        </h1>
      </header>

      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'vocab'} className={tab === 'vocab' ? 'on' : ''} onClick={() => setTab('vocab')}>
          Words · {studyVocab(pack).length}
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
              // A one-kanji word (一) is studied on its kanji card.
              const char = oneKanjiWord(pack, v);
              const status = cardStatus(cards.get(`vocab:${v.id}`) ?? (char ? cards.get(`kanji:${char}`) : undefined));
              const isOpen = open === v.id;
              const group = vocabGroup(pack, v.id);
              const face = isOpen ? cardFace(pack, 'vocab', 'recognition', v.id) : null;
              return (
                <div key={v.id}>
                  <button className="list-item" onClick={() => setOpen(isOpen ? null : v.id)} aria-expanded={isOpen}>
                    <span className={`dot ${status}`} title={STATUS_LABEL[status]} />
                    <span className="term" lang="ja">
                      {group.length > 1 ? wordKey(v.word) : v.word}
                    </span>
                    <span className="gloss">{group.length > 1 ? [...new Set(group.map((m) => m.meaning))].join(' / ') : v.meaning}</span>
                  </button>
                  {isOpen && (
                    <div className="row" style={{ padding: '0 14px 14px', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        {face?.reading && (
                          <div className="reading">
                            {face.senses?.length === 1 ? <PitchReading reading={face.reading} phrases={pitch[face.senses[0].id]} /> : face.reading}
                          </div>
                        )}
                        {face?.senses && face.senses.length > 1 ? null : <div>{v.meaning}</div>}
                        {face?.senses && <WordSenses senses={face.senses} mode={settings.furigana === 'none' ? 'none' : 'all'} say={sayText} pitch={pitch} />}
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
