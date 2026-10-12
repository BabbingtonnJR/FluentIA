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
 * A word card's back: every reading with when it is used and example sentences, so words
 * written the same way (十 じゅう / とお) are learnt together.
 */
export function WordSenses({ senses, mode, say }: { senses: NonNullable<CardFace['senses']>; mode: FuriganaMode; say: (text: string) => void }) {
  const many = senses.length > 1;
  return (
    <div className="senses">
      {senses.map((s, i) => (
        <div key={i} className="sense">
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
          <Examples examples={s.examples} mode={mode} say={say} />
        </div>
      ))}
    </div>
  );
}

/** A kanji card's back: each reading with words that use it, and the rare readings set apart. */
export function KanjiReadings({ face, say }: { face: CardFace; say: (text: string) => void }) {
  if (!face.kanjiReadings?.length) return null;
  return (
    <div className="senses">
      {face.kanjiReadings.map((r) => (
        <div key={r.reading} className="sense">
          <div className="sense-head">
            <span className="sense-reading" lang="ja">
              {r.reading}
            </span>
          </div>
          <div className="kanji-words">
            {r.words.map((w) => (
              <button
                key={w.word}
                className="kanji-word"
                onClick={(e) => {
                  e.stopPropagation();
                  say(w.reading);
                }}
              >
                <span lang="ja" className="jp">
                  {w.word}
                </span>
                <span lang="ja" className="faint jp">
                  {w.reading}
                </span>
                <span className="muted">{w.meaning}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!!face.rareReadings?.length && (
        <div className="faint">
          Rare readings:{' '}
          <span className="jp" lang="ja">
            {face.rareReadings.join('、')}
          </span>
        </div>
      )}
    </div>
  );
}
