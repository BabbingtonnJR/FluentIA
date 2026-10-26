import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { vocabSenses } from '../content/senses';
import type { Pack } from '../content/types';
import { db } from '../db/db';
import { logActivity } from '../db/repo';
import { recordMistake, resolveMistakes } from '../study/weak';
import { usePack, useSettings } from '../hooks';
import { generateQuiz, QUESTION_TITLES, REVIEW_MIN, type Question, type QuizMode } from '../quiz/generate';
import { speak, stopSpeaking } from '../speech/tts';
import { State } from '../srs/scheduler';

export function Quiz() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  // Review (studied words only) is the default; challenge mixes in words not studied yet.
  const [params, setParams] = useSearchParams();
  const mode: QuizMode = params.get('mode') === 'challenge' ? 'challenge' : 'review';
  const setMode = (m: QuizMode) => setParams(m === 'review' ? {} : { mode: m }, { replace: true });
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
        // Best known first, so review rounds open with easy wins.
        cards.sort((a, b) => b.stability - a.stability);
        setQuestions(
          generateQuiz({
            pack,
            studiedVocab: cards.filter((c) => c.kind === 'vocab').map((c) => c.itemId),
            studiedKanji: cards.filter((c) => c.kind === 'kanji').map((c) => c.itemId),
            levels,
            mode,
          }),
        );
        setI(0);
        setPicked(null);
        setScore(0);
      });
    return () => stopSpeaking();
  }, [pack, levelsKey, round, mode]);

  const q = questions?.[i];
  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });

  // Listening questions play automatically.
  useEffect(() => {
    if (q?.type === 'listening' && q.speak) void say(q.speak);
  }, [q]); // only when the question changes

  if (!questions) return null;

  const topbar = (
    <div className="topbar">
      <button className="icon-btn" onClick={() => navigate('/')} aria-label="Close quiz">
        <Icon name="close" />
      </button>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${(i / Math.max(questions.length, 1)) * 100}%` }} />
      </div>
      <span className="faint">
        {Math.min(i + 1, questions.length)}/{questions.length}
      </span>
    </div>
  );

  if (mode === 'review' && questions.length < REVIEW_MIN) {
    return (
      <div className="stack">
        {topbar}
        <div className="empty">
          <span className="jp">学</span>
          <p>The review quiz asks about words you have already studied. Study a few cards first, then come back.</p>
          <p className="faint">Or try a challenge round: it uses new words too, and shows the meaning after each answer.</p>
        </div>
        <Link to="/study" className="btn primary block">
          Study now
        </Link>
        <button className="btn block" onClick={() => setMode('challenge')}>
          Challenge round
        </button>
      </div>
    );
  }

  function pick(n: number) {
    if (!q || picked !== null) return;
    setPicked(n);
    const item = { kind: q.type === 'kanji' ? ('kanji' as const) : ('vocab' as const), id: q.itemId };
    if (n === q.answer) {
      setScore((s) => s + 1);
      void resolveMistakes(pack.manifest.id, [item]);
    } else void recordMistake(pack.manifest.id, item, 'quiz', q.options[n]);
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
    const other: QuizMode = mode === 'review' ? 'challenge' : 'review';
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
        <button className="btn block" onClick={() => setMode(other)}>
          {other === 'challenge' ? 'Challenge round · new words' : 'Review round · studied words'}
        </button>
        <Link to="/" className="btn block">
          Back to Today
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      {topbar}

      <div key={`q${round}-${i}`} className="card center stack question-card" style={{ padding: '28px 16px' }}>
        <div className="faint">
          {QUESTION_TITLES[q.type]}
          {mode === 'challenge' && ' · Challenge'}
        </div>
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
              {/* after answering, every option says what it is, so the wrong ones teach too */}
              {picked !== null && (
                <span className="option-note" lang={q.optionsJp ? 'en' : 'ja'}>
                  {q.notes[n]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {picked !== null && (
        <>
          <AnswerDetail key={`a${round}-${i}`} pack={pack} q={q} onSpeak={say} />
          <button className="btn primary block rise-in" onClick={next}>
            {i + 1 >= questions.length ? 'See results' : 'Next'}
          </button>
        </>
      )}
    </div>
  );
}

/** The answer in full after picking: word with furigana, meaning, audio, and the kanji in it. */
function AnswerDetail({ pack, q, onSpeak }: { pack: Pack; q: Question; onSpeak: (text: string) => unknown }) {
  if (q.type === 'kanji') {
    const k = pack.kanjiById.get(q.itemId);
    if (!k) return null;
    return (
      <div className="card answer-detail rise-in">
        <div className="answer-word" lang="ja">
          {k.id}
        </div>
        <div className="answer-body">
          <div>{k.meanings.join(', ')}</div>
          {k.on.length > 0 && (
            <div className="faint">
              On <span lang="ja">{k.on.join('、')}</span>
            </div>
          )}
          {k.kun.length > 0 && (
            <div className="faint">
              Kun <span lang="ja">{k.kun.join('、')}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const v = pack.vocabById.get(q.itemId);
  if (!v) return null;
  const kanji = [...new Set(v.word)].flatMap((c) => pack.kanjiById.get(c) ?? []);
  const senses = vocabSenses(pack, v.id);
  const withKanji = /\p{Script=Han}/u.test(v.word);
  return (
    <div className="card answer-detail rise-in">
      <div className="answer-word" lang="ja">
        {withKanji ? (
          <ruby>
            {v.word}
            <rt>{v.reading}</rt>
          </ruby>
        ) : (
          v.word
        )}
      </div>
      <div className="answer-body">
        <div>{v.meaning}</div>
        {/* The word's other readings, so 十 じゅう also teaches 十 とお. */}
        {senses.slice(1).map((s) => (
          <div key={s.item.id}>
            <span lang="ja" className="jp">
              {s.reading}
            </span>{' '}
            · {s.meaning}
          </div>
        ))}
        {senses[0]?.examples[0] && (
          <div className="faint">
            <span lang="ja" className="jp">
              <Ruby markup={senses[0].examples[0].r} />
            </span>{' '}
            — {senses[0].examples[0].e}
          </div>
        )}
        {kanji.map((k) => (
          <div key={k.id} className="faint">
            <span lang="ja">{k.id}</span> {k.meanings.slice(0, 3).join(', ')}
          </div>
        ))}
      </div>
      <button className="icon-btn" onClick={() => void onSpeak(v.reading)} aria-label="Play audio">
        <Icon name="speaker" />
      </button>
    </div>
  );
}
