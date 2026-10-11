import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Ruby } from '../components/Ruby';
import type { LitSentence } from '../content/types';
import { db } from '../db/db';
import { logActivity, saveSettings } from '../db/repo';
import type { MangaBlock, Settings } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { loadLocal, saveLocal } from '../lib/local';
import { Breakdown } from '../literature/Breakdown';
import { useKnown, type Known } from '../literature/known';
import { FURIGANA_LABEL } from '../reading/furigana';
import { speak, stopSpeaking } from '../speech/tts';

const FURIGANA_NEXT: Record<Settings['furigana'], Settings['furigana']> = { all: 'unknown', unknown: 'none', none: 'all' };
const BUBBLES_PER_POINT = 10;

interface PageProps {
  mangaId: string;
  page: number;
  blocks: MangaBlock[];
  first: number;
  selected: number | null;
  boxes: boolean;
  furigana: Settings['furigana'];
  known: Known | null;
  onSelect: (n: number | null) => void;
}

/** One page: its image (loaded from the database when it scrolls near), tappable bubbles, and their text. */
function MangaPage({ mangaId, page, blocks, first, selected, boxes, furigana, known, onSelect }: PageProps) {
  const ref = useRef<HTMLElement>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let objectUrl: string | null = null;
    let alive = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || objectUrl) return;
        io.disconnect();
        void db.mangaPages.get(`${mangaId}:${page}`).then((img) => {
          if (!alive || !img) return;
          objectUrl = URL.createObjectURL(img.blob);
          setUrl(objectUrl);
        });
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mangaId, page]);

  return (
    <section ref={ref} className="comic-page" data-page={page}>
      <div className="comic-image manga-image">
        {url ? <img src={url} alt={`Page ${page + 1}`} /> : <div className="manga-placeholder" />}
        {url &&
          boxes &&
          blocks.map((b, i) => {
            const n = first + i;
            const [l, t, r, btm] = b.box;
            return (
              <button
                key={n}
                className={`manga-box${selected === n ? ' on' : ''}`}
                style={{ left: `${l * 100}%`, top: `${t * 100}%`, width: `${(r - l) * 100}%`, height: `${(btm - t) * 100}%` } as CSSProperties}
                onClick={() => onSelect(selected === n ? null : n)}
                aria-label={`Bubble ${n + 1}`}
              />
            );
          })}
      </div>
      {blocks.length > 0 && (
        <ol className="comic-lines" lang="ja">
          {blocks.map((b, i) => {
            const n = first + i;
            return (
              <li key={n} data-b={n}>
                <button className={`comic-line${selected === n ? ' on' : ''}`} onClick={() => onSelect(selected === n ? null : n)}>
                  <span className="comic-num">{n + 1}</span>
                  <span>
                    <Ruby markup={b.s.r} mode={furigana} knownKanji={known?.kanji} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Reads a manga imported with mokuro: page by page, bubbles tappable for their breakdown. */
export function MangaReader() {
  const { id = '' } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const known = useKnown(pack);
  const manga = useLiveQuery(() => db.manga.get(id), [id]);
  const [selected, setSelected] = useState<number | null>(null);
  const [boxes, setBoxes] = useState(() => loadLocal<boolean>('manga:boxes') ?? true);
  const [finished, setFinished] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrolled = useRef(false);
  const posKey = `manga:pos:${id}`;

  const bubbles = useMemo(
    () => (manga ? manga.pages.flatMap((p, page) => p.b.map((b): { s: LitSentence; page: number } => ({ s: b.s, page }))) : []),
    [manga],
  );
  const firstOfPage = useMemo(() => {
    let n = 0;
    return (manga?.pages ?? []).map((p) => {
      const first = n;
      n += p.b.length;
      return first;
    });
  }, [manga]);

  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => {
    if (!manga || scrolled.current) return;
    scrolled.current = true;
    const pos = loadLocal<number>(posKey) ?? 0;
    if (pos > 0) requestAnimationFrame(() => document.querySelector(`[data-page="${pos}"]`)?.scrollIntoView({ block: 'start' }));
  }, [manga, posKey]);

  if (manga === undefined) return null;
  if (manga === null) return <div className="empty">This manga is no longer in the app.</div>;

  const say = (text: string) => void speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  const select = (n: number | null) => {
    setSelected(n);
    if (n === null) return;
    if (bubbles[n].page > (loadLocal<number>(posKey) ?? -1)) saveLocal(posKey, bubbles[n].page);
    document.querySelector(`[data-b="${n}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  function finish() {
    if (finished || !manga) return;
    setFinished(true);
    saveLocal(posKey, manga.pages.length - 1);
    void logActivity(pack.manifest.id, 'literature', { score: Math.max(1, Math.round(bubbles.length / BUBBLES_PER_POINT)), total: bubbles.length }, settings);
  }

  function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    void db
      .transaction('rw', db.manga, db.mangaPages, async () => {
        await db.mangaPages.where('mangaId').equals(id).delete();
        await db.manga.delete(id);
      })
      .then(() => navigate('/literature?tab=manga', { replace: true }));
  }

  return (
    <div className={`stack comic-reader${selected !== null ? ' with-sheet' : ''}`}>
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/literature?tab=manga')} aria-label="Back to manga">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title video-title">{manga.title}</h2>
        <button
          className={`chip${boxes ? ' on' : ''}`}
          onClick={() => {
            setBoxes(!boxes);
            saveLocal('manga:boxes', !boxes);
          }}
        >
          Boxes
        </button>
        <button className="chip" onClick={() => void saveSettings({ furigana: FURIGANA_NEXT[settings.furigana] })}>
          {FURIGANA_LABEL[settings.furigana]}
        </button>
      </div>

      {manga.pages.map((p, page) => (
        <MangaPage
          key={page}
          mangaId={id}
          page={page}
          blocks={p.b}
          first={firstOfPage[page]}
          selected={selected}
          boxes={boxes}
          furigana={settings.furigana}
          known={known}
          onSelect={select}
        />
      ))}

      <div className="lit-end stack">
        {finished ? (
          <div className="empty" style={{ padding: 0 }}>
            <span className="jp stamp">読了</span>
            <p>Finished! It counts towards your progress.</p>
          </div>
        ) : (
          <button className="btn primary block" onClick={finish}>
            I finished this volume
          </button>
        )}
        <p className="faint" style={{ fontSize: '0.8rem', margin: 0 }}>
          Text read by OCR (mokuro), so a few characters may be wrong; the breakdown follows the text as read.
        </p>
        <button className="btn block" onClick={remove}>
          {confirmDelete ? 'Tap again to delete it from this device' : 'Delete this manga'}
        </button>
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
