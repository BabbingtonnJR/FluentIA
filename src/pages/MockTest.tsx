import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { CountUp } from '../components/CountUp';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { loadPassages, loadSentences, loadSpeaking } from '../content/packs';
import type { Sentence } from '../content/types';
import { db } from '../db/db';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { afterMotion } from '../lib/motion';
import { generateMock, likelyPass, scoreMock, SECONDS_PER_QUESTION, SECTIONS, type MockExtras, type MockQuestion } from '../quiz/mock';
import { speak, stopSpeaking } from '../speech/tts';
import { recordMistake } from '../study/weak';

type Phase = 'setup' | 'running' | 'done';

const sectionInfo = (id: string) => SECTIONS.find((s) => s.id === id)!;
const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * A short JLPT-style mock exam for one level, timed, with no feedback until the end —
 * then a score per section, a pass estimate and a review of every mistake.
 */
export function MockTest() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const lang = pack.manifest.id;

  // Levels that have grammar content; default to the hardest one the learner studies.
  const levels = pack.manifest.levels.filter((l) => pack.grammar.some((g) => g.level === l.id));
  const [level, setLevel] = useState(() => {
    const enabled = levels.filter((l) => settings.levels.includes(l.id)).map((l) => l.id);
    return enabled.length ? Math.min(...enabled) : (levels.at(-1)?.id ?? 4);
  });

  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [extras, setExtras] = useState<MockExtras>({});
  const [phase, setPhase] = useState<Phase>('setup');
  const [questions, setQuestions] = useState<MockQuestion[]>([]);
  const [picks, setPicks] = useState<(number | null)[]>([]);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [usedSeconds, setUsedSeconds] = useState(0);
  const finished = useRef(false);

  useEffect(() => {
    loadSentences(lang).then(setSentences, () => setSentences([]));
    // Dialogues and passages make the listening and reading parts like the real test; without them the mock still works.
    loadSpeaking(lang).then((s) => setExtras((x) => ({ ...x, dialogues: s.dialogues, responses: s.responses })), () => {});
    loadPassages(lang).then((passages) => setExtras((x) => ({ ...x, passages })), () => {});
    return () => stopSpeaking();
  }, [lang]);

  const history = useLiveQuery(
    () =>
      db.activities
        .where('[lang+day]')
        .between([lang, ''], [lang, '￿'])
        .filter((a) => a.type === 'mock')
        .sortBy('createdAt')
        .then((all) => all.reverse().slice(0, 5)),
    [lang],
  );

  const limit = questions.length * SECONDS_PER_QUESTION;
  const timeLeft = Math.max(0, limit - Math.floor((now - startedAt) / 1000));
  const q = questions[index];

  const say = (text: string, alt = false) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate, alt });

  // Listening: the conversation, then the question, then (for quick replies) each option by number.
  const playing = useRef(0);
  async function play(question: MockQuestion) {
    const token = ++playing.current;
    stopSpeaking();
    const steps: [string, boolean][] = [
      ...(question.script ?? []).map((l): [string, boolean] => [l.say, l.alt]),
      ...(question.speak ? [[question.speak, false] as [string, boolean]] : []),
      ...(question.audioOptions ? question.options.map((o, n): [string, boolean] => [`${NUMBERS[n]}。${o}`, false]) : []),
    ];
    for (const [text, alt] of steps) {
      if (token !== playing.current) return;
      await say(text, alt);
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  function start() {
    if (!sentences) return;
    finished.current = false;
    const qs = generateMock({ pack, sentences, level, extras });
    setQuestions(qs);
    setPicks(qs.map(() => null));
    setIndex(0);
    heard.current = new Set();
    setChosen(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase('running');
  }

  function finish(finalPicks: (number | null)[]) {
    if (finished.current) return;
    finished.current = true;
    stopSpeaking();
    const result = scoreMock(questions, finalPicks);
    questions.forEach((q, i) => {
      if (q.item && finalPicks[i] !== q.answer) void recordMistake(lang, q.item, 'mock', finalPicks[i] === null ? undefined : q.options[finalPicks[i]!]);
    });
    setUsedSeconds(Math.min(limit, Math.round((Date.now() - startedAt) / 1000)));
    void logActivity(
      lang,
      'mock',
      {
        score: result.correct,
        total: result.total,
        minutes: Math.round((Date.now() - startedAt) / 60_000),
        detail: { level, sections: Object.fromEntries(result.sections.map((s) => [s.section, [s.correct, s.total]])) },
      },
      settings,
    );
    setPhase('done');
  }

  // Clock: ticks every second while running and ends the test when time is up.
  useEffect(() => {
    if (phase !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === 'running' && timeLeft === 0) finish(picks);
  }, [phase, timeLeft]); // picks are read at the moment time runs out

  // Listening questions play once automatically, the first time they are shown.
  const heard = useRef(new Set<number>());
  useEffect(() => {
    if (phase !== 'running' || !q || !(q.speak || q.script) || heard.current.has(index)) return;
    heard.current.add(index);
    void play(q);
    return () => {
      playing.current++;
    };
  }, [phase, index]); // only when the question changes

  /**
   * Answers can be changed until the end, as on the paper test. After answering, move on to
   * the next question still unanswered; once all are answered, stay so the learner can check.
   */
  async function pick(n: number) {
    if (chosen !== null) return;
    setChosen(n);
    const next = picks.map((p, i) => (i === index ? n : p));
    setPicks(next);
    await afterMotion(220);
    setChosen(null);
    const after = next.findIndex((p, i) => i > index && p === null);
    const to = after >= 0 ? after : next.findIndex((p) => p === null);
    if (to >= 0) goTo(to);
  }

  function goTo(i: number) {
    stopSpeaking();
    setIndex(Math.max(0, Math.min(questions.length - 1, i)));
  }

  if (!sentences) return null;

  // --- Setup ---------------------------------------------------------------------
  if (phase === 'setup') {
    return (
      <div className="stack">
        <div className="topbar">
          <button className="icon-btn" onClick={() => navigate('/')} aria-label="Close">
            <Icon name="close" />
          </button>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>
            Mock test<span className="kanji-mark">模試</span>
          </h1>
        </div>

        <div className="card stack">
          <div className="segmented" role="group" aria-label="Level">
            {levels.map((l) => (
              <button key={l.id} className={level === l.id ? 'on' : ''} onClick={() => setLevel(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <ul className="mock-sections">
            {SECTIONS.map((s) => (
              <li key={s.id} className="spread">
                <span>
                  <span className="jp" lang="ja">
                    {s.jp}
                  </span>{' '}
                  <span className="faint">{s.label}</span>
                </span>
                <span className="faint">{s.count} questions</span>
              </li>
            ))}
          </ul>
          <p className="faint" style={{ margin: 0 }}>
            {SECTIONS.reduce((n, s) => n + s.count, 0)} questions in{' '}
            {(SECTIONS.reduce((n, s) => n + s.count, 0) * SECONDS_PER_QUESTION) / 60} minutes. No answers are shown until the end, like the
            real exam. Questions cover the whole level, not just what you have studied.
          </p>
          <button className="btn primary block" onClick={start} disabled={!sentences.length}>
            Start the {levels.find((l) => l.id === level)?.label} mock
          </button>
        </div>

        {history && history.length > 0 && (
          <>
            <div className="section-title">Recent results</div>
            <div className="list">
              {history.map((h) => {
                const label = pack.manifest.levels.find((l) => l.id === h.detail?.level)?.label ?? '';
                return (
                  <div key={h.id} className="list-item" style={{ cursor: 'default' }}>
                    <span className="badge">{label}</span>
                    <span className="gloss">
                      {new Date(h.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ·{' '}
                      {h.detail &&
                        SECTIONS.filter((s) => h.detail!.sections[s.id])
                          .map((s) => `${s.jp} ${h.detail!.sections[s.id][0]}/${h.detail!.sections[s.id][1]}`)
                          .join(' · ')}
                    </span>
                    <strong>{Math.round((h.score / Math.max(1, h.total)) * 100)}%</strong>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // --- Results -------------------------------------------------------------------
  if (phase === 'done') {
    const result = scoreMock(questions, picks);
    const pass = likelyPass(level, result);
    const pct = Math.round((result.correct / Math.max(1, result.total)) * 100);
    const mistakes = questions.map((question, i) => ({ question, pick: picks[i] })).filter(({ question, pick }) => pick !== question.answer);
    return (
      <div className="stack">
        {pass && <Petals />}
        <div className="empty" style={{ paddingBottom: 8 }}>
          <span className="jp stamp mock-stamp" data-pass={pass}>
            {pass ? '合格' : 'もう少し'}
          </span>
          <div className="big-number">
            <CountUp value={pct} suffix="%" />
          </div>
          <p style={{ margin: '4px 0 0' }}>
            {result.correct} / {result.total} correct · {formatTime(usedSeconds)} used
          </p>
          <p className="faint" style={{ margin: '4px 0 0' }}>
            {pass ? 'You would likely pass at this level.' : 'Not quite at the pass mark yet — keep going.'} (Estimate based on the JLPT pass
            mark and section minimums.)
          </p>
        </div>

        <div className="card stack">
          {result.sections.map((s, n) => {
            const info = sectionInfo(s.section);
            return (
              <div key={s.section} className="stack" style={{ gap: 4 }}>
                <div className="spread">
                  <span>
                    <span className="jp" lang="ja">
                      {info.jp}
                    </span>{' '}
                    <span className="faint">{info.label}</span>
                  </span>
                  <strong>
                    {s.correct}/{s.total}
                  </strong>
                </div>
                <div className="xp-track">
                  <div className="xp-fill" style={{ width: `${(s.correct / s.total) * 100}%`, animationDelay: `${300 + n * 120}ms` }} />
                </div>
              </div>
            );
          })}
        </div>

        {mistakes.length > 0 && (
          <>
            <div className="section-title">Review your mistakes · 復習</div>
            <div className="stack" style={{ gap: 8 }}>
              {mistakes.map(({ question, pick: p }, i) => (
                <div key={i} className="card example" style={{ '--i': i } as CSSProperties}>
                  <div className="faint">
                    {sectionInfo(question.section).jp}
                    {question.part ? ` ${question.part}` : ''} · {question.title}
                  </div>
                  {question.passage ? (
                    <div className="faint" lang="ja">
                      「{question.passage.title}」
                    </div>
                  ) : question.script ? (
                    <div className="row" style={{ margin: '6px 0' }}>
                      <button className="icon-btn" onClick={() => void play(question)} aria-label="Play again">
                        <Icon name="speaker" />
                      </button>
                      <span className="faint">Play the audio again</span>
                    </div>
                  ) : question.prompt ? (
                    <p className="sentence small" lang="ja">
                      <Ruby markup={question.prompt.markup} cloze={question.prompt.mark} mode={question.prompt.furigana ? 'all' : 'none'} />
                    </p>
                  ) : (
                    <div className="row" style={{ margin: '6px 0' }}>
                      <button className="icon-btn" onClick={() => question.speak && void say(question.speak)} aria-label="Play audio">
                        <Icon name="speaker" />
                      </button>
                      <span className="jp" lang="ja">
                        {question.speak}
                      </span>
                    </div>
                  )}
                  <div className="review-answer wrong" lang={question.optionsJp ? 'ja' : 'en'}>
                    ✗ {p === null ? '(no answer)' : question.options[p]}
                  </div>
                  <div className="review-answer right" lang={question.optionsJp ? 'ja' : 'en'}>
                    ✓ {question.options[question.answer]}
                  </div>
                  {!!question.also?.length && (
                    <div className="also-right">
                      Also right:{' '}
                      <span className="jp" lang="ja">
                        {question.also.join('、')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <button className="btn primary block" onClick={() => setPhase('setup')}>
          Another mock
        </button>
        <Link to="/" className="btn block">
          Back to Today
        </Link>
      </div>
    );
  }

  // --- Running -------------------------------------------------------------------
  if (!q) return null;
  const info = sectionInfo(q.section);
  const lowTime = timeLeft <= 60;
  const answered = picks.filter((p) => p !== null).length;
  const unanswered = questions.length - answered;
  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => finish(picks)} aria-label="End the test now">
          <Icon name="close" />
        </button>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>
        <span className={`mock-timer${lowTime ? ' low' : ''}`} aria-label={`${formatTime(timeLeft)} left`}>
          {formatTime(timeLeft)}
        </span>
      </div>

      <div key={index} className="card center stack question-card" style={{ padding: '22px 16px' }}>
        <div className="faint">
          <span className="jp" lang="ja">
            {info.jp}
          </span>{' '}
          · {index + 1}/{questions.length}
        </div>
        {q.part && (
          <div className="faint jp" lang="ja">
            {q.part}
          </div>
        )}
        {q.passage && <PassageView passage={q.passage} furigana={settings.furigana !== 'none'} />}
        <div className="muted" style={{ fontWeight: 600 }} lang={q.authored ? 'ja' : undefined}>
          {q.title}
        </div>
        {q.passage ? null : q.script ? (
          <button className="icon-btn pulse-ring" style={{ margin: '12px auto', width: 72, height: 72 }} onClick={() => void play(q)} aria-label="Play again">
            <Icon name="speaker" />
          </button>
        ) : q.prompt ? (
          <p className="sentence" lang="ja" style={{ margin: '0 auto' }}>
            <Ruby markup={q.prompt.markup} cloze={q.prompt.mark} blank={q.prompt.blank} mode={q.prompt.furigana && settings.furigana !== 'none' ? 'all' : 'none'} />
          </p>
        ) : (
          <button className="icon-btn pulse-ring" style={{ margin: '12px auto', width: 72, height: 72 }} onClick={() => q.speak && void say(q.speak)} aria-label="Play again">
            <Icon name="speaker" />
          </button>
        )}
      </div>

      <div key={`o${index}`} className="options">
        {q.options.map((o, n) => (
          <button
            key={o}
            className={`option${q.optionsJp ? ' jp' : ''}${chosen === n || (chosen === null && picks[index] === n) ? ' chosen' : ''}`}
            style={{ '--i': n } as CSSProperties}
            lang={q.optionsJp ? 'ja' : 'en'}
            aria-pressed={picks[index] === n}
            onClick={() => void pick(n)}
          >
            {q.audioOptions ? `${n + 1}` : o}
          </button>
        ))}
      </div>

      <div className="mock-nav">
        <button className="btn" onClick={() => goTo(index - 1)} disabled={index === 0}>
          <Icon name="back" /> Previous
        </button>
        <button className="btn" onClick={() => goTo(index + 1)} disabled={index + 1 >= questions.length}>
          Next →
        </button>
      </div>

      <nav className="mock-grid" aria-label="Questions">
        {questions.map((question, i) => (
          <button
            key={i}
            className={`mock-cell${picks[i] !== null ? ' done' : ''}${i === index ? ' here' : ''}`}
            onClick={() => goTo(i)}
            aria-current={i === index ? 'step' : undefined}
            aria-label={`Question ${i + 1}, ${sectionInfo(question.section).label}${picks[i] !== null ? ', answered' : ''}`}
          >
            {i + 1}
          </button>
        ))}
      </nav>

      <button className={`btn block${unanswered ? '' : ' primary'}`} onClick={() => finish(picks)}>
        {unanswered ? `Finish test · ${unanswered} unanswered` : 'Finish test'}
      </button>
    </div>
  );
}

const NUMBERS = ['いちばん', 'にばん', 'さんばん', 'よんばん'];

/** A reading passage above its question, as on the exam paper. */
function PassageView({ passage, furigana }: { passage: NonNullable<MockQuestion['passage']>; furigana: boolean }) {
  return (
    <div className="passage" lang="ja">
      <div className="passage-title">{passage.title}</div>
      {passage.paragraphs.map((para, i) => (
        <p key={i}>
          {para.map((r, j) => (
            <Ruby key={j} markup={r} mode={furigana ? 'all' : 'none'} />
          ))}
        </p>
      ))}
    </div>
  );
}
