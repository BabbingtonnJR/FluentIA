import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Ruby } from '../components/Ruby';
import type { LitSentence, Pack } from '../content/types';
import { plainText, wordMarkup } from '../reading/furigana';
import type { Known } from './known';
import { FORM_LABEL, POS_LABEL, wordNote } from './notes';

interface Props {
  sentence: LitSentence;
  pack: Pack;
  known: Known | null;
  onSpeak: (text: string) => void;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/**
 * How a sentence is built: the sentence with furigana, the grammar points the app teaches that
 * appear in it, then every word with its dictionary form, part of speech, conjugation, meaning
 * (from the word list) or what it does (particles and auxiliaries).
 */
export function Breakdown({ sentence, pack, known, onSpeak, onClose, onPrev, onNext }: Props) {
  const grammar = (sentence.g ?? []).flatMap(([id, start, end]) => {
    const g = pack.grammarById.get(id);
    return g ? [{ g, span: [start, end] as [number, number] }] : [];
  });
  const plain = plainText(sentence.r);

  return (
    <div className="breakdown" role="dialog" aria-label="Sentence breakdown">
      <div className="breakdown-bar">
        <button className="icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous sentence">
          ‹
        </button>
        <button className="icon-btn" onClick={() => onSpeak(plain)} aria-label="Read aloud">
          <Icon name="speaker" />
        </button>
        <button className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="Next sentence">
          ›
        </button>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" onClick={onClose} aria-label="Close breakdown">
          <Icon name="close" />
        </button>
      </div>

      <div className="breakdown-scroll">
        <p className="breakdown-sentence" lang="ja">
          <Ruby markup={sentence.r} mode="all" cloze={grammar[0]?.span} />
        </p>

        {grammar.length > 0 && (
          <div className="breakdown-grammar">
            {grammar.map(({ g, span }) => (
              <Link key={g.id} to={`/grammar/${encodeURIComponent(g.id)}`} className="chip">
                <span lang="ja">{plain.slice(...span)}</span> · {g.pattern} · {g.meaning}
              </Link>
            ))}
          </div>
        )}

        <ol className="breakdown-words">
          {sentence.w.map((w, i) => {
            const [surface, base, pos = 'other', kana, vocabIdx = -1, form] = w;
            if (pos === 'sym') return null;
            const v = vocabIdx >= 0 ? pack.vocab[vocabIdx] : undefined;
            const note = wordNote(w);
            const isContent = !/^(p|aux|sym)/.test(pos);
            return (
              <li key={i} className={`bw ${isContent ? 'content' : 'grammar'}`}>
                <div className="bw-word" lang="ja">
                  {kana ? <Ruby markup={wordMarkup(surface, kana)} mode="all" /> : surface}
                </div>
                <div className="bw-info">
                  <div className="bw-tags">
                    <span>{POS_LABEL[pos] ?? pos}</span>
                    {form && FORM_LABEL[form] && <span>{FORM_LABEL[form]}</span>}
                    {base && (
                      <span>
                        from <b lang="ja">{base}</b>
                      </span>
                    )}
                  </div>
                  {v ? (
                    <div>
                      {v.meaning}{' '}
                      <span className="faint">
                        · N{v.level}
                        {known?.words.has(vocabIdx) ? ' · studied' : ''}
                      </span>
                    </div>
                  ) : note ? (
                    <div>{note}</div>
                  ) : isContent && pos !== 'name' && pos !== 'num' ? (
                    <a className="faint" href={`https://jisho.org/search/${encodeURIComponent(base || surface)}`} target="_blank" rel="noreferrer">
                      Not in the N5–N3 list · look up on Jisho ↗
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
