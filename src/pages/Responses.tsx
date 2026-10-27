import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { SpeakBack } from '../components/SpeakBack';
import { loadSpeaking } from '../content/packs';
import type { QuickResponse } from '../content/types';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { speak, stopSpeaking } from '../speech/tts';

const ROUND = 10;
const THINK_SECONDS = [3, 5, 8];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Quick replies (即時応答): someone says something, and you answer out loud before the time runs
 * out — no reading, no translating. Then the natural answer, to say again properly. What you froze
 * on comes back once at the end of the round.
 */
export function Responses() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [all, setAll] = useState<QuickResponse[] | null>(null);
  const [queue, setQueue] = useState<QuickResponse[]>([]);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'setup' | 'think' | 'reveal' | 'done'>('setup');
  const [seconds, setSeconds] = useState(5);
  const [left, setLeft] = useState(0);
  const [showText, setShowText] = useState(false);
  const [tally, setTally] = useState({ said: 0, froze: 0 });
  const startedAt = useRef(0);

  useEffect(() => {
    loadSpeaking(pack.manifest.id).then((s) => setAll(s.responses), () => setAll([]));
    return () => stopSpeaking();
  }, [pack]);

  const say = (text: string, alt = false) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate, alt });
  const item = queue[i];

  // Each item: play what was said (or show the situation), then count down.
  useEffect(() => {
    if (phase !== 'think' || !item) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    setLeft(0);
    const countdown = () => {
      if (!alive) return;
      setLeft(seconds);
      timer = setInterval(() => setLeft((s) => (s <= 1 ? (clearInterval(timer), -1) : s - 1)), 1000);
    };
    if (item.prompt) void say(item.prompt.say, true).then(countdown);
    else countdown();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, i]);

  function start() {
    if (!all) return;
    const mine = all.filter((r) => settings.levels.includes(r.level));
    setQueue(shuffle(mine.length >= ROUND ? mine : all).slice(0, ROUND));
    setI(0);
    setTally({ said: 0, froze: 0 });
    startedAt.current = Date.now();
    setShowText(false);
    setPhase('think');
  }

  function reveal() {
    stopSpeaking();
    setPhase('reveal');
    void say(item.good.say);
  }

  function next(gotIt: boolean) {
    stopSpeaking();
    const t = gotIt ? { ...tally, said: tally.said + 1 } : { ...tally, froze: tally.froze + 1 };
    setTally(t);
    const again = !gotIt && queue.filter((q) => q.id === item.id).length < 2;
    const nextQueue = again ? [...queue, item] : queue;
    setQueue(nextQueue);
    if (i + 1 >= nextQueue.length) {
      setPhase('done');
      const minutes = Math.max(1, Math.round((Date.now() - startedAt.current) / 60_000));
      void logActivity(pack.manifest.id, 'responses', { score: t.said, total: t.said + t.froze, minutes }, settings);
      return;
    }
    setI(i + 1);
    setShowText(false);
    setPhase('think');
  }

  const rubyMode = settings.furigana === 'none' ? 'none' : 'all';

  if (phase === 'setup' || !item) {
    return (
      <div className="stack">
        <div className="topbar">
          <button className="icon-btn" onClick={() => navigate('/speak')} aria-label="Back">
            <Icon name="back" />
          </button>
          <h2 className="wordle-title">
            Quick replies <span className="jp faint">即時応答</span>
          </h2>
        </div>
        <p className="faint" style={{ margin: 0 }}>
          You'll hear something someone says to you, or read a situation. Answer <b>out loud</b> before the time runs out. Any natural answer
          counts: the point is not to freeze. This is also the last part of the JLPT listening test.
        </p>
        <div className="field">
          <span className="label">Time to answer</span>
          <div className="segmented" role="group">
            {THINK_SECONDS.map((s) => (
              <button key={s} className={seconds === s ? 'on' : ''} onClick={() => setSeconds(s)}>
                {s} s
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary block" disabled={!all?.length} onClick={start}>
          Start ({ROUND} replies)
        </button>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="stack">
        {tally.said > tally.froze && <Petals count={16} />}
        <div className="empty">
          <span className="jp stamp">{tally.froze === 0 ? '完璧' : 'いいね'}</span>
          <h2 style={{ margin: '0 0 8px' }}>
            {tally.said} answered · {tally.froze} froze
          </h2>
          <p className="faint">Froze on some? That's normal. Do another round tomorrow and they'll come quicker.</p>
        </div>
        <button className="btn primary block" onClick={start}>
          Another round
        </button>
        <Link to="/speak" className="btn block">
          Back to speaking
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => (stopSpeaking(), setPhase('setup'))} aria-label="Stop">
          <Icon name="close" />
        </button>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(i / queue.length) * 100}%` }} />
        </div>
        <span className="faint">
          {i + 1}/{queue.length}
        </span>
      </div>

      <div key={i} className="card stack center question-card" style={{ gap: 12, padding: '24px 16px' }}>
        {item.prompt ? (
          <>
            <div className="faint">Someone says to you:</div>
            <button className="icon-btn listen-prompt" onClick={() => void say(item.prompt!.say, true)} aria-label="Hear it again">
              <Icon name="speaker" />
            </button>
            {showText || phase === 'reveal' ? (
              <>
                <p className="sentence" lang="ja" style={{ margin: 0 }}>
                  <Ruby markup={item.prompt.s.r} mode={rubyMode} />
                </p>
                {phase === 'reveal' && <div className="faint">{item.prompt.s.e}</div>}
              </>
            ) : (
              <button className="memo-text" onClick={() => setShowText(true)}>
                Show what they said
              </button>
            )}
          </>
        ) : (
          <>
            <div className="faint">What do you say?</div>
            <div className="prompt-en" style={{ fontSize: '1.15rem' }}>
              {item.situation}
            </div>
          </>
        )}

        {phase === 'think' && left !== 0 && (
          <div className="countdown" role="timer" aria-live="polite">
            <div className="countdown-ring" data-urgent={left > 0 && left <= 2}>
              {left > 0 ? left : '!'}
            </div>
            <div className="faint">{left > 0 ? 'Answer out loud now' : "Time's up. Say anything natural, then check."}</div>
          </div>
        )}
      </div>

      {phase === 'think' ? (
        <button className="btn primary block" onClick={reveal}>
          Show a good answer
        </button>
      ) : (
        <div className="card stack rise-in" style={{ gap: 10 }}>
          <div className="stat-label">A natural answer</div>
          <p className="sentence" lang="ja" style={{ margin: 0 }}>
            <Ruby markup={item.good.s.r} mode={rubyMode} />
          </p>
          <div className="faint">{item.good.s.e}</div>
          <SpeakBack key={`a${i}`} sentence={item.good.s} say={item.good.say} onListen={(t) => say(t)} />
          <details className="faint">
            <summary>Answers that would sound wrong here</summary>
            {item.bad.map((b) => (
              <div key={b.say} lang="ja" style={{ marginTop: 4 }}>
                ✗ {b.say}
              </div>
            ))}
          </details>
          <div className="grid-2">
            <button className="btn" onClick={() => next(false)}>
              I froze
            </button>
            <button className="btn primary" onClick={() => next(true)}>
              I answered
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
