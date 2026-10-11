import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Ruby } from '../components/Ruby';
import { db } from '../db/db';
import { logActivity, saveSettings } from '../db/repo';
import type { Settings } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { loadLocal, saveLocal } from '../lib/local';
import { Breakdown } from '../literature/Breakdown';
import { useKnown } from '../literature/known';
import { FURIGANA_LABEL } from '../reading/furigana';
import { speak, stopSpeaking } from '../speech/tts';

const FURIGANA_NEXT: Record<Settings['furigana'], Settings['furigana']> = { all: 'unknown', unknown: 'none', none: 'all' };
const LINES_PER_POINT = 10;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Watch an imported video line by line: the current subtitle with furigana under the video, an
 * option to pause after each line, and every line's breakdown one tap away.
 */
export function VideoPlayer() {
  const { id = '' } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const known = useKnown(pack);
  const record = useLiveQuery(() => db.videos.get(id), [id]);
  const videoEl = useRef<HTMLVideoElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [current, setCurrent] = useState(() => loadLocal<number>(`video:pos:${id}`) ?? 0);
  const [stopEach, setStopEach] = useState(() => loadLocal<boolean>('video:stop-each') ?? true);
  const [sheet, setSheet] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [finished, setFinished] = useState(false);
  // The line to pause at the end of, set when a line starts playing.
  const stopAt = useRef<number | null>(null);

  const source = picked ?? record?.video ?? null;
  const url = useMemo(() => (source ? URL.createObjectURL(source) : null), [source]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => () => stopSpeaking(), []);

  const lines = record?.lines ?? [];
  useEffect(() => {
    saveLocal(`video:pos:${id}`, current);
    document.querySelector(`[data-line="${current}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current, id]);

  if (record === undefined) return null;
  if (record === null) return <div className="empty">This video is no longer in the app.</div>;

  const say = (text: string) => void speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  function onTime() {
    const v = videoEl.current;
    if (!v) return;
    const t = v.currentTime;
    // The line on screen: the last one that has started.
    let i = Math.min(current, lines.length - 1);
    while (i + 1 < lines.length && lines[i + 1].start <= t) i++;
    while (i > 0 && lines[i].start > t) i--;
    if (i !== current) setCurrent(i);
    if (stopEach && !v.paused && stopAt.current !== null && t >= lines[stopAt.current].end - 0.05) {
      v.pause();
      stopAt.current = null;
    }
  }

  function playLine(i: number) {
    const v = videoEl.current;
    setCurrent(i);
    if (!v) return;
    v.currentTime = lines[i].start;
    stopAt.current = i;
    void v.play();
  }

  function onPlay() {
    // Pressing play mid-video stops at the end of the line on screen.
    if (stopAt.current === null) stopAt.current = current;
  }

  function finish() {
    if (finished) return;
    setFinished(true);
    void logActivity(pack.manifest.id, 'literature', { score: Math.max(1, Math.round(lines.length / LINES_PER_POINT)), total: lines.length }, settings);
  }

  const line = lines[current];
  return (
    <div className={`stack video-player${sheet !== null ? ' with-sheet' : ''}`}>
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/literature?tab=video')} aria-label="Back to videos">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title video-title">{record.title}</h2>
        <button className="chip" onClick={() => void saveSettings({ furigana: FURIGANA_NEXT[settings.furigana] })}>
          {FURIGANA_LABEL[settings.furigana]}
        </button>
      </div>

      {url ? (
        <video ref={videoEl} className="video-el" src={url} controls playsInline preload="metadata" onTimeUpdate={onTime} onPlay={onPlay} />
      ) : (
        <label className="field video-pick">
          <span>
            Pick the video file to watch along{record.videoName ? ` (${record.videoName})` : ''}. You can also just read the lines below.
          </span>
          <input type="file" accept="video/*" onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
        </label>
      )}

      {line && (
        <div className="card video-line">
          <button className="video-line-text" lang="ja" onClick={() => setSheet(current)}>
            <Ruby markup={line.s.r} mode={settings.furigana} knownKanji={known?.kanji} />
          </button>
          <div className="video-controls">
            <button className="icon-btn" onClick={() => playLine(Math.max(0, current - 1))} aria-label="Previous line">
              ‹
            </button>
            <button
              className="icon-btn"
              onClick={() => (url ? playLine(current) : say(line.s.w.map((w) => w[0]).join('')))}
              aria-label="Play this line"
            >
              ↻
            </button>
            <button className="icon-btn" onClick={() => playLine(Math.min(lines.length - 1, current + 1))} aria-label="Next line">
              ›
            </button>
            <span className="faint video-count">
              {current + 1}/{lines.length}
            </span>
            <button
              className={`chip${stopEach ? ' on' : ''}`}
              onClick={() => {
                setStopEach(!stopEach);
                saveLocal('video:stop-each', !stopEach);
              }}
            >
              Pause each line
            </button>
            <button className="chip" onClick={() => setSheet(current)}>
              Breakdown
            </button>
          </div>
        </div>
      )}

      <ol className="video-lines" lang="ja">
        {lines.map((l, i) => (
          <li key={i} data-line={i}>
            <button className={`comic-line${i === current ? ' on' : ''}`} onClick={() => (url ? playLine(i) : setCurrent(i))}>
              <span className="comic-num">{clock(l.start)}</span>
              <span>
                <Ruby markup={l.s.r} mode={settings.furigana} knownKanji={known?.kanji} />
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="lit-end stack">
        {finished ? (
          <div className="empty" style={{ padding: 0 }}>
            <span className="jp stamp">完走</span>
            <p>Done! It counts towards your progress.</p>
          </div>
        ) : (
          <button className="btn primary block" onClick={finish}>
            I finished this video
          </button>
        )}
        <button
          className="btn block"
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            void db.videos.delete(id).then(() => navigate('/literature?tab=video', { replace: true }));
          }}
        >
          {confirmDelete ? 'Tap again to delete it from this device' : 'Delete this video'}
        </button>
      </div>

      {sheet !== null && lines[sheet] && (
        <Breakdown
          key={sheet}
          sentence={lines[sheet].s}
          pack={pack}
          known={known}
          onSpeak={say}
          onClose={() => setSheet(null)}
          onPrev={sheet > 0 ? () => setSheet(sheet - 1) : undefined}
          onNext={sheet < lines.length - 1 ? () => setSheet(sheet + 1) : undefined}
          onPlayFrom={
            url
              ? () => {
                  setSheet(null);
                  playLine(sheet);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
