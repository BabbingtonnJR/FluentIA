import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Ruby } from '../components/Ruby';
import { SpeakBack } from '../components/SpeakBack';
import type { LitSentence, LitWord, Pack } from '../content/types';
import { db } from '../db/db';
import { mineCustom, mineVocab, vocabCardId } from '../study/mine';
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
  /** Plays a recording from this sentence, when the work has one. */
  onPlayFrom?: () => void;
  /** Title of what is being read or watched, kept with words mined from it. */
  source?: string;
}

/**
 * How a sentence is built: the sentence with furigana, the grammar points the app teaches that
 * appear in it, then every word with its dictionary form, part of speech, conjugation, meaning
 * (from the word list) or what it does (particles and auxiliaries).
 */
export function Breakdown({ sentence, pack, known, onSpeak, onClose, onPrev, onNext, onPlayFrom, source }: Props) {
  const grammar = (sentence.g ?? []).flatMap(([id, start, end]) => {
    const g = pack.grammarById.get(id);
    return g ? [{ g, span: [start, end] as [number, number] }] : [];
  });
  const plain = plainText(sentence.r);
  const [speaking, setSpeaking] = useState(false);

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
        <button className={`chip${speaking ? ' on' : ''}`} onClick={() => setSpeaking((v) => !v)} aria-pressed={speaking}>
          Say it
        </button>
        {onPlayFrom && (
          <button className="chip" onClick={onPlayFrom}>
            ▶ Play from here
          </button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="Close breakdown">
          <Icon name="close" />
        </button>
      </div>

      <div className="breakdown-scroll">
        <p className="breakdown-sentence" lang="ja">
          <Ruby markup={sentence.r} mode="all" cloze={grammar[0]?.span} />
        </p>
        {sentence.e && <p className="breakdown-translation faint">{sentence.e}</p>}
        {speaking && <SpeakBack sentence={sentence} say={plain} onListen={onSpeak} shadow />}

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
                      {isContent && <MineVocab pack={pack} vocabId={v.id} sentence={sentence} source={source} />}
                    </div>
                  ) : note ? (
                    <div>{note}</div>
                  ) : isContent && pos !== 'name' && pos !== 'num' ? (
                    <>
                      <a className="faint" href={`https://jisho.org/search/${encodeURIComponent(base || surface)}`} target="_blank" rel="noreferrer">
                        Not in the N5–N3 list · look up on Jisho ↗
                      </a>
                      <MineCustom lang={pack.manifest.id} word={w} sentence={sentence} source={source} />
                    </>
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

/** Starts studying a word from the word list, with this sentence on its card. */
function MineVocab({ pack, vocabId, sentence, source }: { pack: Pack; vocabId: string; sentence: LitSentence; source?: string }) {
  const id = vocabCardId(pack, vocabId);
  const card = useLiveQuery(() => db.cards.get(id).then((c) => (c && !c.deleted ? c : null)), [id], 'loading' as const);
  const [mined, setMined] = useState(false);
  if (card === 'loading') return null;
  if (!card && !mined) {
    return (
      <button className="chip mine" onClick={() => void mineVocab(pack, vocabId, { r: sentence.r, e: sentence.e, source }).then(() => setMined(true))}>
        + Study
      </button>
    );
  }
  if (mined) return <span className="chip mine done">✓ Added with this sentence</span>;
  return <span className="faint"> · in your study</span>;
}

/** A word outside the word list becomes the learner's own card, with the meaning they write. */
function MineCustom({ lang, word, sentence, source }: { lang: string; word: LitWord; sentence: LitSentence; source?: string }) {
  const [surface, base, , kana] = word;
  const text = base || surface;
  const [open, setOpen] = useState(false);
  const [meaning, setMeaning] = useState('');
  const [done, setDone] = useState(false);
  if (done) return <span className="chip mine done">✓ In your Mined words deck</span>;
  if (!open) {
    return (
      <button className="chip mine" onClick={() => setOpen(true)}>
        + My card
      </button>
    );
  }
  return (
    <form
      className="mine-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!meaning.trim()) return;
        // The reading tagged on the word is for its surface form; keep it only when that is what the card shows.
        const reading = !base || base === surface ? kana : undefined;
        void mineCustom(lang, { text, reading, meaning }, { r: sentence.r, e: sentence.e, source }).then(() => setDone(true));
      }}
    >
      <input className="input" autoFocus placeholder={`Meaning of ${text}`} value={meaning} onChange={(e) => setMeaning(e.target.value)} aria-label={`Meaning of ${text}`} />
      <button className="btn small primary" disabled={!meaning.trim()}>
        Add
      </button>
    </form>
  );
}
