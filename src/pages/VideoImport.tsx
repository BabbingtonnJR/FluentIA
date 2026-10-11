import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import { usePack } from '../hooks';
import { analyseCues } from '../video/analyse';
import { decodeSubtitles, parseSubtitles } from '../video/subtitles';

type Stage = { step: 'idle' } | { step: 'dictionary' } | { step: 'lines'; done: number; total: number } | { step: 'saving' };

const titleFrom = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim();
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;

/**
 * Imports a video the learner owns together with a Japanese subtitle file. Each line is broken down
 * here on the device; nothing is uploaded. The video can be kept in the app or picked again later.
 */
export function VideoImport() {
  const pack = usePack();
  const navigate = useNavigate();
  const [video, setVideo] = useState<File | null>(null);
  const [subs, setSubs] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [keep, setKeep] = useState(true);
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const busy = stage.step !== 'idle';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!subs) return;
    setError(null);
    try {
      const cues = parseSubtitles(decodeSubtitles(await subs.arrayBuffer()), subs.name);
      if (!cues.length) throw new Error('No Japanese lines found in that subtitle file.');
      setStage({ step: 'dictionary' });
      const lines = await analyseCues(cues, pack, (done) => setStage({ step: 'lines', done, total: cues.length }));
      setStage({ step: 'saving' });
      const id = crypto.randomUUID();
      await db.videos.add({
        id,
        lang: pack.manifest.id,
        title: title.trim() || titleFrom(video?.name ?? subs.name),
        createdAt: Date.now(),
        subtitleName: subs.name,
        lines,
        video: keep && video ? video : undefined,
        videoName: video?.name,
      });
      navigate(`/videos/${id}`, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/quota/i.test(message) ? 'Not enough space on this device to keep the video. Import it without keeping the video.' : message);
      setStage({ step: 'idle' });
    }
  }

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/literature?tab=video')} aria-label="Back">
          <Icon name="close" />
        </button>
        <h2 className="wordle-title">Import a video</h2>
      </div>

      <p className="faint" style={{ margin: 0 }}>
        Use an episode or clip you have, plus its Japanese subtitle file (.srt, .ass or .vtt). Every line gets the same word-by-word
        breakdown as the stories. Everything stays on this device.
      </p>

      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Japanese subtitles</span>
          <input
            type="file"
            accept=".srt,.ass,.ssa,.vtt,text/plain"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setSubs(f);
              if (f && !title) setTitle(titleFrom(f.name));
            }}
            disabled={busy}
            required
          />
        </label>
        <label className="field">
          <span>Video (optional)</span>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setVideo(f);
              if (f) setTitle(titleFrom(f.name));
            }}
            disabled={busy}
          />
          {video && <span className="faint">{mb(video.size)} · MKV files may not play on iPhone; MP4 works everywhere.</span>}
        </label>
        {video && (
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={busy} />
            <span>Keep the video in the app ({mb(video.size)}), instead of picking the file again each time</span>
          </label>
        )}
        <label className="field">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </label>

        {error && (
          <div className="empty" style={{ padding: 0 }}>
            {error}
          </div>
        )}

        <button className="btn primary block" type="submit" disabled={!subs || busy}>
          {stage.step === 'dictionary'
            ? 'Loading the dictionary (first time ~17 MB)…'
            : stage.step === 'lines'
              ? `Breaking down lines… ${stage.done}/${stage.total}`
              : stage.step === 'saving'
                ? 'Saving…'
                : 'Import'}
        </button>
      </form>

      <p className="faint" style={{ fontSize: '0.8rem' }}>
        Only import videos you have the right to use. Japanese subtitles for shows are often shared by fans; check where they come from.
      </p>
    </div>
  );
}
