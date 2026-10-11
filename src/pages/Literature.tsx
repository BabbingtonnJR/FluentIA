import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { loadLiteratureIndex } from '../content/packs';
import type { LitIndexEntry } from '../content/types';
import { usePack } from '../hooks';
import { loadLocal } from '../lib/local';
import { useKnown } from '../literature/known';

/** Learners read about 150–250 characters a minute; use the slow end. */
const CHARS_PER_MINUTE = 150;

/** The literature shelf: public-domain stories from Aozora Bunko, easiest first. */
export function Literature() {
  const pack = usePack();
  const known = useKnown(pack);
  const [works, setWorks] = useState<LitIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLiteratureIndex(pack.manifest.id).then(setWorks, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [pack]);

  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          Literature<span className="kanji-mark">文学</span>
        </h1>
      </header>
      <p className="faint" style={{ margin: 0 }}>
        Real Japanese stories, free in the public domain. Tap any sentence to see how it is built, word by word.
      </p>

      {error && <div className="empty">Could not load the stories. Open the app once while online. ({error})</div>}

      <div className="list">
        {works?.map((w, i) => {
          const knownWords = known ? w.words.filter((x) => known.words.has(x)).length : null;
          const pos = loadLocal<number>(`lit:pos:${w.id}`) ?? 0;
          const progress = Math.min(1, (pos + 1) / w.sentences);
          return (
            <Link key={w.id} to={`/literature/${w.id}`} className="lit-shelf-item" style={{ '--i': i } as CSSProperties}>
              <div className="lit-shelf-title">
                <span className="jp" lang="ja">
                  {w.title}
                </span>
                <span className="lit-level">≈{w.level}</span>
              </div>
              <div className="faint">
                {w.titleEn} · <span lang="ja">{w.author}</span>
              </div>
              <div className="faint">
                ~{Math.max(1, Math.round(w.chars / CHARS_PER_MINUTE))} min · {w.sentences} sentences
                {knownWords !== null && ` · ${knownWords}/${w.words.length} of its listed words studied`}
              </div>
              {pos > 0 && (
                <div className="progress-track" aria-label={`${Math.round(progress * 100)}% read`}>
                  <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
                </div>
              )}
            </Link>
          );
        })}
      </div>

      <p className="faint" style={{ fontSize: '0.8rem' }}>
        Texts from <a href="https://www.aozora.gr.jp/">Aozora Bunko (青空文庫)</a>, typed and proofread by volunteers. Levels are a rough guide.
      </p>
    </div>
  );
}
