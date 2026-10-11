import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { loadComicsIndex, loadLiteratureIndex } from '../content/packs';
import type { ComicIndexEntry, LitIndexEntry } from '../content/types';
import { usePack } from '../hooks';
import { loadLocal } from '../lib/local';
import { useKnown, type Known } from '../literature/known';

/** Learners read about 150–250 characters a minute; use the slow end. */
const CHARS_PER_MINUTE = 150;
/** Every fifth Pepper&Carrot episode is a wordless special. */
const FEW_BUBBLES = 5;

const TABS = [
  { id: 'stories', label: 'Stories', jp: '物語' },
  { id: 'comic', label: 'Comic', jp: '漫画' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** The literature shelf: public-domain stories (Aozora Bunko) and the Pepper&Carrot comic. */
export function Literature() {
  const pack = usePack();
  const known = useKnown(pack);
  // The tab lives in the URL so "back" from a story or episode returns to it.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'comic' ? 'comic' : 'stories';

  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          Literature<span className="kanji-mark">文学</span>
        </h1>
      </header>
      <p className="faint" style={{ margin: 0 }}>
        Real Japanese to read, free to share. Tap any sentence or speech bubble to see how it is built, word by word.
      </p>

      <div className="segmented" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setParams(t.id === 'stories' ? {} : { tab: t.id }, { replace: true })}
          >
            {t.label} · <span lang="ja">{t.jp}</span>
          </button>
        ))}
      </div>

      {tab === 'stories' ? <Stories known={known} /> : <Comics known={known} />}
    </div>
  );
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, deps);
  return { data, error };
}

function Progress({ share }: { share: number }) {
  return (
    <div className="progress-track" aria-label={`${Math.round(share * 100)}% read`}>
      <div className="progress-fill" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

function Stories({ known }: { known: Known | null }) {
  const pack = usePack();
  const { data: works, error } = useLoad(() => loadLiteratureIndex(pack.manifest.id), [pack]);
  return (
    <>
      {error && <div className="empty">Could not load the stories. Open the app once while online. ({error})</div>}
      <div className="list">
        {works?.map((w: LitIndexEntry, i) => {
          const knownWords = known ? w.words.filter((x) => known.words.has(x)).length : null;
          const pos = loadLocal<number>(`lit:pos:${w.id}`) ?? 0;
          return (
            <Link key={w.id} to={`/literature/${w.id}`} className="lit-shelf-item" style={{ '--i': i } as CSSProperties}>
              <div className="lit-shelf-title">
                <span className="jp" lang="ja">
                  {w.title}
                </span>
                <span className="lit-tags">
                  {w.audio && <span className="lit-level">audio</span>}
                  <span className="lit-level">≈{w.level}</span>
                </span>
              </div>
              <div className="faint">
                {w.titleEn} · <span lang="ja">{w.author}</span>
              </div>
              <div className="faint">
                ~{Math.max(1, Math.round(w.chars / CHARS_PER_MINUTE))} min · {w.sentences} sentences
                {knownWords !== null && ` · ${knownWords}/${w.words.length} of its listed words studied`}
              </div>
              {pos > 0 && <Progress share={Math.min(1, (pos + 1) / w.sentences)} />}
            </Link>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: '0.8rem' }}>
        Texts from <a href="https://www.aozora.gr.jp/">Aozora Bunko (青空文庫)</a>, typed and proofread by volunteers. Levels are a rough guide.
      </p>
    </>
  );
}

function Comics({ known }: { known: Known | null }) {
  const pack = usePack();
  const { data: episodes, error } = useLoad(() => loadComicsIndex(pack.manifest.id), [pack]);
  return (
    <>
      <p className="faint" style={{ margin: 0 }}>
        <b>Pepper&amp;Carrot</b>: a young witch and her cat, in Japanese. Casual speech, short bubbles, about N4–N3. Pages load
        from peppercarrot.com and stay saved once seen.
      </p>
      {error && <div className="empty">Could not load the comic. Open the app once while online. ({error})</div>}
      <div className="list">
        {episodes?.map((e: ComicIndexEntry, i) => {
          const knownWords = known ? e.words.filter((x) => known.words.has(x)).length : null;
          const pos = loadLocal<number>(`comic:pos:${e.id}`) ?? -1;
          return (
            <Link key={e.id} to={`/comics/${e.id}`} className="lit-shelf-item" style={{ '--i': Math.min(i, 12) } as CSSProperties}>
              <div className="lit-shelf-title">
                <span className="jp" lang="ja">
                  {e.number}. {e.title}
                </span>
                {e.bubbles < FEW_BUBBLES && <span className="lit-level">no words</span>}
              </div>
              <div className="faint">
                {e.pages} pages · {e.bubbles} {e.bubbles === 1 ? 'bubble' : 'bubbles'}
                {knownWords !== null && e.words.length > 0 && ` · ${knownWords}/${e.words.length} listed words studied`}
              </div>
              {pos >= 0 && <Progress share={Math.min(1, (pos + 1) / e.pages)} />}
            </Link>
          );
        })}
      </div>
      <p className="faint" style={{ fontSize: '0.8rem' }}>
        <a href="https://www.peppercarrot.com/ja/">Pepper&amp;Carrot</a> by David Revoy, Japanese translation by its volunteer translators, licensed{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Word breakdowns added by Fluentia.
      </p>
    </>
  );
}
