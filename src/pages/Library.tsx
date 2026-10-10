import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import type { VocabItem } from '../content/types';
import { db } from '../db/db';
import type { CardRecord } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { speak } from '../speech/tts';
import { cardStatus, type CardStatus } from '../stats/stats';

const PAGE = 80;
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
  const [tab, setTab] = useState<'vocab' | 'kanji'>('vocab');
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
  const vocab = useMemo(
    () =>
      pack.vocab.filter(
        (v) =>
          (level === null || v.level === level) &&
          (!q || v.word.includes(q) || v.reading.includes(q) || v.meaning.toLowerCase().includes(q)),
      ),
    [pack, level, q],
  );
  const kanji = useMemo(
    () =>
      pack.kanji.filter(
        (k) =>
          (level === null || k.level === level) &&
          (!q ||
            k.id === q ||
            k.meanings.some((m) => m.toLowerCase().includes(q)) ||
            [...k.on, ...k.kun].some((r) => r.replace(/[.-]/g, '').includes(q))),
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
      </div>

      <input
        className="input"
        type="search"
        placeholder="Search Japanese, reading or English"
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
