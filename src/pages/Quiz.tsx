import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { db } from '../db/db';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { generateQuiz, QUESTION_TITLES, type Question } from '../quiz/generate';
import { speak, stopSpeaking } from '../speech/tts';
import { State } from '../srs/scheduler';

export function Quiz() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);

  const levelsKey = settings.levels.join(',');
  useEffect(() => {
    const lang = pack.manifest.id;
    const levels = levelsKey ? levelsKey.split(',').map(Number) : pack.manifest.levels.map((l) => l.id);
    db.cards
      .where('[lang+due]')
      .between([lang, -Infinity], [lang, Infinity])
      .filter((c) => c.direction === 'recognition' && c.state !== State.New)
      .toArray()
      .then((cards) => {
        setQuestions(
          generateQuiz({
            pack,
            studiedVocab: cards.filter((c) => c.kind === 'vocab').map((c) => c.itemId),
            studiedKanji: cards.filter((c) => c.kind === 'kanji').map((c) => c.itemId),
            levels,
          }),
        );
        setI(0);
        setPicked(null);
        setScore(0);
      });
    return () => stopSpeaking();
  }, [pack, levelsKey, round]);

  const q = questions?.[i];
  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  // Listening questions play automatically.
  useEffect(() => {
    if (q?.type === 'listening' && q.speak) void say(q.speak);
  }, [q]); // only when the question changes

  if (!questions) return null;

  function pick(n: number) {
    if (!q || picked !== null) return;
    setPicked(n);
    if (n === q.answer) setScore((s) => s + 1);
    if (q.speak && q.type !== 'listening') void say(q.speak);
  }

  function next() {
    if (!questions) return;
    if (i + 1 >= questions.length) {
      void logActivity(pack.manifest.id, 'quiz', { score, total: questions.length }, settings);
    }
    setI(i + 1);
    setPicked(null);
  }

  if (!q) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="stack">
        {pct >= 50 && <Petals count={pct >= 80 ? 28 : 14} />}
        <div className="empty">
          <span className="jp stamp">{pct >= 80 ? '素晴らしい' : pct >= 50 ? 'いいね' : '頑張って'}</span>
          <h2 style={{ margin: '0 0 8px' }}>
            {score} / {questions.length}
          </h2>
          <p>{pct >= 80 ? 'Excellent work.' : pct >= 50 ? 'Good — keep reviewing.' : 'Keep going, it gets easier with reviews.'}</p>
        </div>
        <button className="btn primary block" onClick={() => setRound((r) => r + 1)}>
          Another round
        </button>
        <Link to="/" className="btn block">
          Back to Today
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Close quiz">
          <Icon name="close" />
        </button>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(i / questions.length) * 100}%` }} />
        </div>
        <span className="faint">
          {i + 1}/{questions.length}
        </span>
      </div>

      <div key={`q${round}-${i}`} className="card center stack question-card" style={{ padding: '28px 16px' }}>
        <div className="faint">{QUESTION_TITLES[q.type]}</div>
        {q.type === 'listening' ? (
          <button className="icon-btn pulse-ring" style={{ margin: '12px auto', width: 72, height: 72 }} onClick={() => q.speak && void say(q.speak)} aria-label="Play again">
            <Icon name="speaker" />
          </button>
        ) : (
          <div className={q.type === 'kanji' ? 'prompt-kanji' : 'prompt-jp'} lang="ja">
            {q.prompt}
          </div>
        )}
      </div>

      <div key={`o${round}-${i}`} className={`options${picked !== null ? ' answered' : ''}`}>
        {q.options.map((o, n) => {
          const state = picked === null ? '' : n === q.answer ? ' correct' : n === picked ? ' wrong' : '';
          return (
            <button
              key={o}
              className={`option${q.optionsJp ? ' jp' : ''}${state}`}
              style={{ '--i': n } as CSSProperties}
              lang={q.optionsJp ? 'ja' : 'en'}
              onClick={() => pick(n)}
            >
              {o}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <button className="btn primary block rise-in" onClick={next}>
          {i + 1 >= questions.length ? 'See results' : 'Next'}
        </button>
      )}
    </div>
  );
}
