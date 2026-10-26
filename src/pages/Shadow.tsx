import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Ruby } from '../components/Ruby';
import { SpeakBack } from '../components/SpeakBack';
import { loadLiteratureIndex, loadLiteratureWork, loadSpeaking } from '../content/packs';
import type { LitIndexEntry, SpeakingPack, SpokenLine } from '../content/types';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { plainText } from '../reading/furigana';
import { speak, stopSpeaking } from '../speech/tts';

interface Source {
  id: string;
  title: string;
  titleEn: string;
  level: string;
  load: () => Promise<SpokenLine[]>;
}

const SPEEDS = [
  { label: 'Slow', value: 0.7 },
  { label: 'Natural', value: 1 },
];

/**
 * Shadowing (シャドーイング): play a sentence and say it at the same time as the voice, then
 * compare your recording. It trains the mouth and the ear together — rhythm, speed and pitch —
 * which is what makes speaking feel automatic.
 */
export function Shadow() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const lang = pack.manifest.id;
  const [sources, setSources] = useState<Source[] | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [lines, setLines] = useState<SpokenLine[] | null>(null);
  const [i, setI] = useState(0);
  const [hideText, setHideText] = useState(false);
  const [rate, setRate] = useState(0.7);
  const [showEn, setShowEn] = useState(false);
  const said = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    Promise.all([loadSpeaking(lang).catch((): SpeakingPack => ({ dialogues: [], responses: [] })), loadLiteratureIndex(lang).catch((): LitIndexEntry[] => [])]).then(([speaking, shelf]) => {
      const fromDialogues: Source[] = speaking.dialogues.map((d) => ({
        id: d.id,
        title: d.title,
        titleEn: d.titleEn,
        level: `N${d.level}`,
        load: async () => d.lines,
      }));
      const fromReaders: Source[] = shelf
        .filter((w) => w.graded)
        .map((w) => ({
          id: w.id,
          title: w.title,
          titleEn: w.titleEn,
          level: w.level,
          load: async () =>
            (await loadLiteratureWork(lang, w.id)).body.flatMap((b) => ('s' in b ? b.s.map((s) => ({ s, say: plainText(s.r) })) : [])),
        }));
      setSources([...fromDialogues, ...fromReaders].sort((a, b) => b.level.localeCompare(a.level)));
    });
    return () => stopSpeaking();
  }, [lang]);

  // Log the time spent when leaving.
  useEffect(
    () => () => {
      if (!said.current) return;
      void logActivity(lang, 'shadowing', { score: said.current, total: said.current, minutes: Math.max(1, Math.round((Date.now() - startedAt.current) / 60_000)) }, settings);
    },
    [],
  );

  async function open(s: Source) {
    setSource(s);
    setLines(null);
    setI(0);
    if (!startedAt.current) startedAt.current = Date.now();
    setLines(await s.load());
  }

  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: rate * settings.speechRate });
  const rubyMode = settings.furigana === 'none' ? 'none' : 'all';

  if (!source) {
    return (
      <div className="stack">
        <div className="topbar">
          <button className="icon-btn" onClick={() => navigate('/speak')} aria-label="Back">
            <Icon name="back" />
          </button>
          <h2 className="wordle-title">
            Shadowing <span className="jp faint">シャドーイング</span>
          </h2>
        </div>
        <ol className="steps faint">
          <li>Listen to the sentence once.</li>
          <li>
            Tap <b>Shadow</b> and speak <i>with</i> the voice, a fraction behind it.
          </li>
          <li>Play yourself back and copy the rhythm, not just the words.</li>
        </ol>
        <div className="list">
          {(sources ?? []).map((s) => (
            <button key={s.id} className="list-item" onClick={() => void open(s)}>
              <span className="term" lang="ja">
                {s.title}
              </span>
              <span className="gloss">
                {s.level} · {s.titleEn}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const line = lines?.[i];

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => (stopSpeaking(), setSource(null))} aria-label="Choose another text">
          <Icon name="close" />
        </button>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${lines ? (i / lines.length) * 100 : 0}%` }} />
        </div>
        <span className="faint">{lines ? `${i + 1}/${lines.length}` : ''}</span>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="segmented" role="group" style={{ flex: 1 }}>
          {SPEEDS.map((s) => (
            <button key={s.value} className={rate === s.value ? 'on' : ''} onClick={() => setRate(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
        <button className={`chip${hideText ? ' on' : ''}`} onClick={() => setHideText((h) => !h)}>
          {hideText ? 'Text hidden' : 'Hide text'}
        </button>
      </div>

      {line && (
        <div key={i} className="card stack question-card" style={{ gap: 12, padding: '22px 16px' }}>
          <p className={`sentence shadow-text${hideText ? ' hidden' : ''}`} lang="ja" style={{ margin: 0 }}>
            <Ruby markup={line.s.r} mode={rubyMode} />
          </p>
          {line.s.e && (
            <button className="memo-text center" onClick={() => setShowEn((v) => !v)}>
              {showEn ? line.s.e : 'Show meaning'}
            </button>
          )}
          <SpeakBack sentence={line.s} say={line.say} onListen={say} shadow onAttempt={() => (said.current += 1)} />
        </div>
      )}

      {lines && (
        <div className="grid-2">
          <button className="btn" disabled={i === 0} onClick={() => (stopSpeaking(), setI(i - 1), setShowEn(false))}>
            ‹ Previous
          </button>
          {i + 1 < lines.length ? (
            <button className="btn primary" onClick={() => (stopSpeaking(), setI(i + 1), setShowEn(false))}>
              Next ›
            </button>
          ) : (
            <button className="btn primary" onClick={() => setSource(null)}>
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
