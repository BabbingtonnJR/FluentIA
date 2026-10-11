import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { loadLiteratureWork } from '../content/packs';
import type { LitBlock, LitSentence, LitWork } from '../content/types';
import { logActivity, saveSettings } from '../db/repo';
import type { Settings } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { loadLocal, saveLocal } from '../lib/local';
import { AudioBar, chapterName, useChapterAudio } from '../literature/AudioBar';
import { Breakdown } from '../literature/Breakdown';
import { useKnown } from '../literature/known';
import { FURIGANA_LABEL } from '../reading/furigana';
import { speak, stopSpeaking } from '../speech/tts';

const FURIGANA_NEXT: Record<Settings['furigana'], Settings['furigana']> = { all: 'unknown', unknown: 'none', none: 'all' };

/** Sentences per point of score when a story is finished (a short story is worth a quiz or so). */
const SENTENCES_PER_POINT = 10;
const NO_BODY: LitBlock[] = [];

/** Reads one story. Tap a sentence for its breakdown; the place you stopped is remembered. */
export function LitReader() {
  const { id = '' } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const known = useKnown(pack);
  const [work, setWork] = useState<LitWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const scrolled = useRef(false);
  const posKey = `lit:pos:${id}`;

  useEffect(() => {
    loadLiteratureWork(pack.manifest.id, id).then(setWork, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => stopSpeaking();
  }, [pack, id]);

  // Every sentence in reading order, for numbering and prev / next.
  const sentences = useMemo(() => (work ? work.body.flatMap((b): LitSentence[] => ('s' in b ? b.s : [])) : []), [work]);

  const player = useChapterAudio(work?.audio, work?.body ?? NO_BODY, work?.title ?? '');

  // While following along, keep the sentence being read in view (unless a breakdown is open).
  useEffect(() => {
    if (player.now === null || !player.follow || selected !== null) return;
    document.querySelector(`[data-s="${player.now}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (player.now > (loadLocal<number>(posKey) ?? -1)) saveLocal(posKey, player.now);
  }, [player.now, player.follow, selected, posKey]);

  // Back where you left off.
  useEffect(() => {
    if (!work || scrolled.current) return;
    scrolled.current = true;
    const pos = loadLocal<number>(posKey) ?? 0;
    if (pos > 0) document.querySelector(`[data-s="${pos}"]`)?.scrollIntoView({ block: 'center' });
  }, [work, posKey]);

  if (error) return <div className="empty">Could not load this story. Open it once while online. ({error})</div>;
  if (!work) return null;

  const say = (text: string) => void speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  const select = (n: number | null) => {
    setSelected(n);
    if (n === null) return;
    if (n > (loadLocal<number>(posKey) ?? -1)) saveLocal(posKey, n);
    document.querySelector(`[data-s="${n}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  function finish() {
    if (finished || !work) return;
    setFinished(true);
    saveLocal(posKey, work.sentences - 1);
    void logActivity(pack.manifest.id, 'literature', { score: Math.max(1, Math.round(work.sentences / SENTENCES_PER_POINT)), total: work.sentences }, settings);
  }

  let n = 0;
  let chapterIndex = 0;
  return (
    <div className={`stack lit-reader${selected !== null ? ' with-sheet' : ''}${player.chapter !== null ? ' with-audio' : ''}`}>
      {finished && <Petals count={24} />}
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/literature')} aria-label="Back to the shelf">
          <Icon name="close" />
        </button>
        <span style={{ flex: 1 }} />
        <button className="chip" onClick={() => void saveSettings({ furigana: FURIGANA_NEXT[settings.furigana] })}>
          Furigana: {FURIGANA_LABEL[settings.furigana]}
        </button>
      </div>

      <header className="lit-head">
        <h1 lang="ja">{work.title}</h1>
        <div className="faint">
          {work.titleEn} · <span lang="ja">{work.author}</span> ({work.authorEn}) · {work.graded ? work.level : `≈${work.level}`}
        </div>
        <div className="faint">Tap a sentence to see how it is built.</div>
        {player.available && player.chapter === null && (
          <button className="btn block" style={{ marginTop: 10 }} onClick={() => player.playFrom(Math.max(0, loadLocal<number>(posKey) ?? 0))}>
            ▶ Listen along · LibriVox reading
          </button>
        )}
      </header>

      <article className="lit-text" lang="ja">
        {work.body.map((block, b) => {
          if ('h' in block) {
            const c = chapterIndex++;
            return (
              <h2 key={b}>
                {block.h}
                {player.available && (
                  <button className="chapter-play" onClick={() => player.playChapter(c)} aria-label={`Play chapter ${chapterName(c)}`}>
                    ▶
                  </button>
                )}
              </h2>
            );
          }
          return (
            <p key={b}>
              {block.s.map((s) => {
                const index = n++;
                return (
                  <span
                    key={index}
                    data-s={index}
                    className={`lit-sentence${selected === index ? ' on' : ''}${player.now === index ? ' now' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => select(selected === index ? null : index)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      select(index);
                    }}
                  >
                    <Ruby markup={s.r} mode={settings.furigana} knownKanji={known?.kanji} />
                  </span>
                );
              })}
            </p>
          );
        })}
      </article>

      <div className="lit-end stack">
        {finished ? (
          <div className="empty" style={{ padding: 0 }}>
            <span className="jp stamp">読了</span>
            <p>Finished! It counts towards your progress.</p>
          </div>
        ) : (
          <button className="btn primary block" onClick={finish}>
            I finished reading
          </button>
        )}
        <p className="faint" style={{ fontSize: '0.8rem', margin: 0 }}>
          {work.graded ? (
            'A graded reader written for Fluentia with the words and grammar of its level. Tap a sentence for its translation.'
          ) : (
            <>
              From <a href={work.url}>Aozora Bunko (青空文庫)</a>
            </>
          )}
          {work.credit.source && (
            <>
              . Source: <span lang="ja">{work.credit.source}</span>
            </>
          )}
          {work.credit.input && (
            <>
              . Input: <span lang="ja">{work.credit.input}</span>
            </>
          )}
          {work.credit.proof && (
            <>
              , proofreading: <span lang="ja">{work.credit.proof}</span>
            </>
          )}
          . Furigana is partly generated, so a few readings may be off.
          {work.audio && (
            <>
              {' '}
              Audio: <a href={work.audio.page}>LibriVox</a> volunteer reading (public domain); following along is estimated, so it can be a sentence off.
            </>
          )}
        </p>
        <Link to="/literature" className="btn block">
          Back to the shelf
        </Link>
      </div>

      {selected !== null && sentences[selected] && (
        <Breakdown
          key={selected}
          sentence={sentences[selected]}
          pack={pack}
          known={known}
          onSpeak={say}
          onClose={() => select(null)}
          onPrev={selected > 0 ? () => select(selected - 1) : undefined}
          onNext={selected < sentences.length - 1 ? () => select(selected + 1) : undefined}
          onPlayFrom={player.available ? () => player.playFrom(selected) : undefined}
        />
      )}
      <AudioBar player={player} />
    </div>
  );
}
