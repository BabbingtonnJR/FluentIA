import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { loadComicEpisode } from '../content/packs';
import type { ComicEpisode, LitSentence } from '../content/types';
import { logActivity, saveSettings } from '../db/repo';
import type { Settings } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { loadLocal, saveLocal } from '../lib/local';
import { Breakdown } from '../literature/Breakdown';
import { useKnown } from '../literature/known';
import { FURIGANA_LABEL } from '../reading/furigana';
import { speak, stopSpeaking } from '../speech/tts';

const FURIGANA_NEXT: Record<Settings['furigana'], Settings['furigana']> = { all: 'unknown', unknown: 'none', none: 'all' };
/** Bubbles per point of score when an episode is finished. */
const BUBBLES_PER_POINT = 10;

/**
 * Reads one Pepper&Carrot episode: each page with numbered markers on its speech bubbles, and the
 * bubbles' text with furigana below it. Tapping either opens the word-by-word breakdown.
 */
export function ComicReader() {
  const { id = '' } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const known = useKnown(pack);
  const [episode, setEpisode] = useState<ComicEpisode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  // Markers sit on the bubbles; hide them to read the page as drawn.
  const [markers, setMarkers] = useState(() => loadLocal<boolean>('comic:markers') ?? true);
  const scrolled = useRef(false);
  const posKey = `comic:pos:${id}`;

  useEffect(() => {
    loadComicEpisode(pack.manifest.id, id).then(setEpisode, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => stopSpeaking();
  }, [pack, id]);

  // Every bubble in reading order, with the page it is on, for numbering and prev / next.
  const bubbles = useMemo(
    () => (episode ? episode.pages.flatMap((p, page) => p.b.map((b): { s: LitSentence; page: number } => ({ s: b.s, page }))) : []),
    [episode],
  );

  // Back to the page where you left off.
  useEffect(() => {
    if (!episode || scrolled.current) return;
    scrolled.current = true;
    const pos = loadLocal<number>(posKey) ?? 0;
    if (pos > 0) document.querySelector(`[data-page="${pos}"]`)?.scrollIntoView({ block: 'start' });
  }, [episode, posKey]);

  if (error) return <div className="empty">Could not load this episode. Open it once while online. ({error})</div>;
  if (!episode) return null;

  const say = (text: string) => void speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  const select = (n: number | null) => {
    setSelected(n);
    if (n === null) return;
    const page = bubbles[n].page;
    if (page > (loadLocal<number>(posKey) ?? -1)) saveLocal(posKey, page);
    document.querySelector(`[data-b="${n}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  function finish() {
    if (finished || !episode) return;
    setFinished(true);
    saveLocal(posKey, episode.pages.length - 1);
    void logActivity(pack.manifest.id, 'literature', { score: Math.max(1, Math.round(episode.bubbles / BUBBLES_PER_POINT)), total: episode.bubbles }, settings);
  }

  // Bubbles are numbered across the whole episode; markers and lines of a page share numbers.
  const firstOfPage = episode.pages.map((_, i) => episode.pages.slice(0, i).reduce((sum, p) => sum + p.b.length, 0));

  return (
    <div className={`stack comic-reader${selected !== null ? ' with-sheet' : ''}`}>
      {finished && <Petals count={24} />}
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/literature?tab=comic')} aria-label="Back to the episodes">
          <Icon name="close" />
        </button>
        <span style={{ flex: 1 }} />
        <button
          className={`chip${markers ? ' on' : ''}`}
          onClick={() => {
            setMarkers(!markers);
            saveLocal('comic:markers', !markers);
          }}
        >
          Markers
        </button>
        <button className="chip" onClick={() => void saveSettings({ furigana: FURIGANA_NEXT[settings.furigana] })}>
          Furigana: {FURIGANA_LABEL[settings.furigana]}
        </button>
      </div>

      <header className="lit-head">
        <h1 lang="ja">
          {episode.number}. {episode.title}
        </h1>
        <div className="faint">Pepper&amp;Carrot · Tap a numbered bubble, or a line under the page.</div>
      </header>

      {episode.pages.map((page, p) => (
        <section key={page.img} className="comic-page" data-page={p}>
          <div className="comic-image">
            <img src={page.img} alt={`Page ${p + 1}`} loading={p < 2 ? 'eager' : 'lazy'} />
            {markers && page.b.map((b, i) => {
              const index = firstOfPage[p] + i;
              return (
                <button
                  key={index}
                  className={`comic-marker${selected === index ? ' on' : ''}`}
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` } as CSSProperties}
                  onClick={() => select(selected === index ? null : index)}
                  aria-label={`Bubble ${index + 1}`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          {page.b.length > 0 && (
            <ol className="comic-lines" lang="ja">
              {page.b.map((b, i) => {
                const index = firstOfPage[p] + i;
                return (
                  <li key={index} data-b={index}>
                    <button className={`comic-line${selected === index ? ' on' : ''}`} onClick={() => select(selected === index ? null : index)}>
                      <span className="comic-num">{index + 1}</span>
                      <span>
                        <Ruby markup={b.s.r} mode={settings.furigana} knownKanji={known?.kanji} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ))}

      <div className="lit-end stack">
        {finished ? (
          <div className="empty" style={{ padding: 0 }}>
            <span className="jp stamp">読了</span>
            <p>Finished! It counts towards your progress.</p>
          </div>
        ) : (
          <button className="btn primary block" onClick={finish}>
            I finished this episode
          </button>
        )}
        <p className="faint" style={{ fontSize: '0.8rem', margin: 0 }}>
          <a href={`https://www.peppercarrot.com/ja/webcomic/${episode.id}.html`}>Pepper&amp;Carrot</a> by {episode.credit.art}
          {episode.credit.translation.length > 0 && <>, Japanese translation by {episode.credit.translation.join(', ')}</>}, licensed{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Furigana and word breakdowns are generated by Fluentia, so a few may be off.
        </p>
        <Link to="/literature?tab=comic" className="btn block">
          Back to the episodes
        </Link>
      </div>

      {selected !== null && bubbles[selected] && (
        <Breakdown
          key={selected}
          sentence={bubbles[selected].s}
          pack={pack}
          known={known}
          onSpeak={say}
          onClose={() => select(null)}
          onPrev={selected > 0 ? () => select(selected - 1) : undefined}
          onNext={selected < bubbles.length - 1 ? () => select(selected + 1) : undefined}
        />
      )}
    </div>
  );
}
