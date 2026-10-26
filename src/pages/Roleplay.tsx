import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { SpeakBack } from '../components/SpeakBack';
import { loadSpeaking } from '../content/packs';
import type { Dialogue } from '../content/types';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { speak, stopSpeaking } from '../speech/tts';

/** With the Japanese of your lines shown (read it out), or only their meaning (say it yourself). */
type Mode = 'read' | 'say';

/**
 * A role-play: the learner takes one part of a dialogue and says their lines out loud; the app
 * speaks the other parts. "Say it" mode shows only what to say in English, which is what real
 * conversation asks for: producing the sentence, not reading it.
 */
export function Roleplay() {
  const { id } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [dialogue, setDialogue] = useState<Dialogue | null | undefined>(undefined);
  const [role, setRole] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('read');
  // How many lines have been played or said so far.
  const [at, setAt] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const startedAt = useRef(0);
  const logged = useRef(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadSpeaking(pack.manifest.id).then((s) => setDialogue(s.dialogues.find((d) => d.id === id) ?? null), () => setDialogue(null));
    return () => stopSpeaking();
  }, [pack, id]);

  const lines = dialogue?.lines ?? [];
  const current = role === null ? undefined : lines[at];
  const myTurn = current?.who === role;
  const done = role !== null && at >= lines.length;

  const say = (text: string, who: number) =>
    speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate, alt: who % 2 === 1 });

  // The other parts speak by themselves, one after another, until it's the learner's turn.
  useEffect(() => {
    if (!current || myTurn) return;
    let alive = true;
    void say(current.say, current.who).then(() => alive && setAt((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [at, role]); // the next line, once the previous one is over

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [at, revealed]);

  useEffect(() => {
    if (!done || logged.current || !dialogue) return;
    logged.current = true;
    const mine = lines.filter((l) => l.who === role).length;
    void logActivity(pack.manifest.id, 'roleplay', { score: mine, total: mine, minutes: Math.max(1, Math.round((Date.now() - startedAt.current) / 60_000)) }, settings);
  }, [done]);

  if (dialogue === undefined) return null;
  if (!dialogue) {
    return (
      <div className="empty">
        This role-play was not found. <Link to="/speak">Back to speaking</Link>
      </div>
    );
  }

  const topbar = (
    <div className="topbar">
      <button className="icon-btn" onClick={() => (role === null ? navigate('/speak') : (stopSpeaking(), setRole(null)))} aria-label="Back">
        <Icon name={role === null ? 'back' : 'close'} />
      </button>
      {role === null ? (
        <h2 className="wordle-title" lang="ja">
          {dialogue.title}
        </h2>
      ) : (
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(at / lines.length) * 100}%` }} />
        </div>
      )}
    </div>
  );

  // --- Choosing a part --------------------------------------------------------------------
  if (role === null) {
    return (
      <div className="stack">
        {topbar}
        <div className="card stack" style={{ gap: 6 }}>
          <strong>{dialogue.titleEn}</strong>
          <div className="faint">{dialogue.situation}</div>
        </div>
        <div className="field">
          <span className="label">Your lines</span>
          <div className="segmented" role="group">
            <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>
              Read them
            </button>
            <button className={mode === 'say' ? 'on' : ''} onClick={() => setMode('say')}>
              Say from English
            </button>
          </div>
          <span className="faint">
            {mode === 'read' ? 'Start here: read your Japanese lines aloud.' : 'The real test: only the meaning is shown, you build the sentence.'}
          </span>
        </div>
        <div className="section-title">Play as</div>
        <div className="stack" style={{ gap: 8 }}>
          {dialogue.roles.map((r, i) => (
            <button
              key={r.jp}
              className="btn block"
              onClick={() => {
                startedAt.current = Date.now();
                logged.current = false;
                setAt(0);
                setRevealed(false);
                setRole(i);
              }}
            >
              <span lang="ja">{r.jp}</span> · {r.en}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const rubyMode = settings.furigana === 'none' ? 'none' : 'all';

  return (
    <div className="stack">
      {topbar}
      <div className="chat">
        {lines.slice(0, Math.min(at, lines.length)).map((l, i) => (
          <div key={i} className={`bubble${l.who === role ? ' mine' : ''}`}>
            <div className="bubble-who">{dialogue.roles[l.who].jp}</div>
            <div lang="ja">
              <Ruby markup={l.s.r} mode={rubyMode} />
            </div>
            <div className="faint bubble-en">{l.s.e}</div>
          </div>
        ))}
        {current && !myTurn && (
          <div className="bubble speaking">
            <div className="bubble-who">{dialogue.roles[current.who].jp}</div>
            <div lang="ja">
              <Ruby markup={current.s.r} mode={rubyMode} />
            </div>
          </div>
        )}
      </div>

      {current && myTurn && (
        <div className="card stack your-turn rise-in" style={{ gap: 10 }}>
          <div className="stat-label">Your turn</div>
          <div className="prompt-en" style={{ fontSize: '1.1rem' }}>
            {current.s.e}
          </div>
          {(mode === 'read' || revealed) && (
            <p className="sentence" lang="ja" style={{ margin: 0 }}>
              <Ruby markup={current.s.r} mode={rubyMode} />
            </p>
          )}
          <SpeakBack key={at} sentence={current.s} say={current.say} onListen={(t) => say(t, current.who)} />
          <div className="row" style={{ gap: 8 }}>
            {mode === 'say' && !revealed && (
              <button className="btn ghost" onClick={() => setRevealed(true)}>
                Show the Japanese
              </button>
            )}
            <button
              className="btn primary"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                setRevealed(false);
                setAt((n) => n + 1);
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="stack rise-in">
          <Petals count={14} />
          <div className="notice">お疲れさま! Now try the other part, or the same one from English.</div>
          <div className="grid-2">
            <button className="btn" onClick={() => setRole(null)}>
              Again
            </button>
            <Link to="/speak" className="btn primary">
              More scenes
            </Link>
          </div>
        </div>
      )}
      <div ref={bottom} />
    </div>
  );
}
