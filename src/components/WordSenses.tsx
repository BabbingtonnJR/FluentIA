import { useState } from 'react';
import type { CardFace, WordExample } from '../content/types';
import type { FuriganaMode } from '../reading/furigana';
import { plainText } from '../reading/furigana';
import { Icon } from './Icon';
import { Ruby } from './Ruby';

/** Example sentences, each with its translation and a button to hear it. */
export function Examples({ examples, mode, say }: { examples: WordExample[]; mode: FuriganaMode; say: (text: string) => void }) {
  if (!examples.length) return null;
  return (
    <ul className="examples">
      {examples.map((x) => (
        <li key={x.r}>
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              say(plainText(x.r));
            }}
            aria-label="Play the sentence"
          >
            <Icon name="speaker" />
          </button>
          <div>
            <div className="example-jp" lang="ja">
              <Ruby markup={x.r} mode={mode} />
            </div>
            <div className="muted">{x.e}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A word card's back: every reading with when it is used, so words written the same way
 * (十 じゅう / とお) are learnt together. One example sentence is shown; the rest wait behind
 * "More examples" so the card stays short.
 */
export function WordSenses({ senses, mode, say }: { senses: NonNullable<CardFace['senses']>; mode: FuriganaMode; say: (text: string) => void }) {
  const [all, setAll] = useState(false);
  const many = senses.length > 1;
  const shown = (i: number) => (all ? senses[i].examples.slice(0, 2) : senses[i].examples.slice(0, i === firstWithExamples(senses) ? 1 : 0));
  const hidden = senses.reduce((n, s, i) => n + Math.min(2, s.examples.length) - shown(i).length, 0);
  return (
    <div className="senses">
      {senses.map((s, i) => (
        <div key={i} className={`sense${many ? '' : ' single'}`}>
          {many && (
            <div className="sense-head">
              {s.reading && (
                <span className="sense-reading" lang="ja">
                  {s.reading}
                </span>
              )}
              <span>{s.meaning}</span>
            </div>
          )}
          {s.note && <div className="sense-note">{s.note}</div>}
          <Examples examples={shown(i)} mode={mode} say={say} />
        </div>
      ))}
      {hidden > 0 && (
        <button
          className="memo-text more-examples"
          onClick={(e) => {
            e.stopPropagation();
            setAll(true);
          }}
        >
          More examples ({hidden})
        </button>
      )}
    </div>
  );
}

const firstWithExamples = (senses: NonNullable<CardFace['senses']>) => Math.max(0, senses.findIndex((s) => s.examples.length > 0));

/**
 * A kanji's readings as one list: the usual reading first, then each other reading with what
 * around the kanji makes it read that way (一: いち, but ひと before つ or 人), with a few words.
 */
export function KanjiReadings({ face, say }: { face: CardFace; say: (text: string) => void }) {
  if (!face.kanjiReadings?.length) return null;
  return (
    <div className="kanji-readings">
      {face.kanjiReadings.map((r) => (
        <div key={r.reading} className="kr-row">
          <div className="kr-head">
            <span className="kr-reading" lang="ja">
              {r.reading}
            </span>
            <span className="kr-when faint">
              {r.main ? (
                'usual reading'
              ) : (
                <>
                  with{' '}
                  <span lang="ja" className="jp">
                    {r.when.join('　')}
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="kr-words">
            {r.words.map((w) => (
              <button
                key={w.word}
                className="kr-word"
                onClick={(e) => {
                  e.stopPropagation();
                  say(w.reading);
                }}
                title={w.meaning}
              >
                <span lang="ja" className="jp">
                  {w.word}
                </span>
                <span lang="ja" className="faint jp">
                  {w.reading}
                </span>
                <span className="kr-meaning">{w.meaning.split(/[;,(]/)[0]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!!face.rareReadings?.length && (
        <div className="faint kr-rare">
          Rarely also{' '}
          <span className="jp" lang="ja">
            {face.rareReadings.join('、')}
          </span>
        </div>
      )}
    </div>
  );
}
