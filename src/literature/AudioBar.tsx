import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import type { LitAudio, LitBlock } from '../content/types';
import { loadLocal, saveLocal } from '../lib/local';
import { stopSpeaking } from '../speech/tts';
import { chapterOf, chapters, sentenceAt, timeOf } from './follow';

const RATES = [0.75, 1, 1.25];
const CHAPTER_NAMES = '一二三四五六七八九十';
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const chapterName = (c: number) => CHAPTER_NAMES[c] ?? String(c + 1);

/**
 * Plays a LibriVox reading chapter by chapter, and tells the reader which sentence is probably
 * being read (from the share of the chapter's characters), so the text can follow along.
 */
export function useChapterAudio(audio: LitAudio | undefined, body: LitBlock[], title: string) {
  const list = useMemo(() => chapters(body), [body]);
  const el = useRef<HTMLAudioElement | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  const [rate, setRate] = useState(() => loadLocal<number>('lit:rate') ?? 1);
  const [follow, setFollow] = useState(true);

  // The element knows the exact length only for the chapter loaded in it; LibriVox's figure otherwise.
  const duration = (c: number) => {
    const d = el.current?.duration;
    return c === chapter && d && Number.isFinite(d) ? d : (audio?.chapters[c].seconds ?? 0);
  };

  useEffect(() => {
    if (!audio) return;
    const a = new Audio();
    a.preload = 'metadata';
    el.current = a;
    return () => {
      a.pause();
      a.removeAttribute('src');
      el.current = null;
    };
  }, [audio]);

  function play(c: number, at = 0) {
    const a = el.current;
    if (!audio || !a) return;
    stopSpeaking();
    if (chapter !== c || !a.src) {
      a.src = audio.chapters[c].url;
      setChapter(c);
      setTime(0);
    }
    const start = () => {
      a.currentTime = at;
      a.playbackRate = rate;
      void a.play();
    };
    if (a.readyState >= 1) start();
    else a.addEventListener('loadedmetadata', start, { once: true });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `${title} ${chapterName(c)}`, artist: 'LibriVox' });
    }
  }

  // Wire the element's events to state: progress, the sentence being read, next chapter at the end.
  useEffect(() => {
    const a = el.current;
    if (!a || chapter === null) return;
    const onTime = () => {
      setTime(a.currentTime);
      setNow(sentenceAt(list[chapter], a.currentTime, duration(chapter)));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (audio && chapter + 1 < audio.chapters.length) play(chapter + 1);
      else setNow(null);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
    };
  }); // bound again each render so the handlers see the current chapter

  return {
    available: !!audio,
    chapter,
    playing,
    time,
    now,
    follow,
    rate,
    duration: chapter === null ? 0 : duration(chapter),
    playChapter: (c: number) => play(c),
    playFrom: (sentence: number) => {
      const c = chapterOf(list, sentence);
      play(c, Math.max(0, timeOf(list[c], sentence, duration(c)) - 0.5));
    },
    toggle: () => {
      const a = el.current;
      if (!a) return;
      if (chapter === null) play(0);
      else if (a.paused) void a.play();
      else a.pause();
    },
    back: () => {
      if (el.current) el.current.currentTime = Math.max(0, el.current.currentTime - 10);
    },
    stop: () => {
      el.current?.pause();
      setChapter(null);
      setNow(null);
    },
    setFollow,
    nextRate: () => {
      const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
      setRate(r);
      if (el.current) el.current.playbackRate = r;
      saveLocal('lit:rate', r);
    },
  };
}

export type ChapterAudio = ReturnType<typeof useChapterAudio>;

/** The player bar at the bottom of the reader while a chapter is playing. */
export function AudioBar({ player }: { player: ChapterAudio }) {
  if (player.chapter === null) return null;
  return (
    <div className="audio-bar" role="region" aria-label="Audio player">
      <button className="icon-btn" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>
        {player.playing ? '❚❚' : '▶'}
      </button>
      <button className="icon-btn" onClick={player.back} aria-label="Back 10 seconds">
        ↺
      </button>
      <div className="audio-info">
        <span lang="ja">{chapterName(player.chapter)}</span>
        <span className="faint">
          {clock(player.time)} / {clock(player.duration)}
        </span>
      </div>
      <button className="chip" onClick={player.nextRate} aria-label="Playback speed">
        {player.rate}×
      </button>
      <button className={`chip${player.follow ? ' on' : ''}`} onClick={() => player.setFollow(!player.follow)}>
        Follow
      </button>
      <button className="icon-btn" onClick={player.stop} aria-label="Stop">
        <Icon name="close" />
      </button>
    </div>
  );
}
