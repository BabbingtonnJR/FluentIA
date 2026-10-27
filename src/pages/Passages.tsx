import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Petals } from '../components/Petals';
import { Ruby } from '../components/Ruby';
import { loadPassages } from '../content/packs';
import type { Passage } from '../content/types';
import { logActivity } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { Breakdown } from '../literature/Breakdown';
import { useKnown } from '../literature/known';
import { plainText } from '../reading/furigana';
import { speak, stopSpeaking } from '../speech/tts';

const KIND_LABEL: Record<Passage['kind'], { jp: string; en: string }> = {
  short: { jp: '短文', en: 'Short text' },
  mid: { jp: '中文', en: 'Mid-length text' },
  info: { jp: '情報検索', en: 'Finding information' },
};

/** Characters a minute to aim for: about the pace the real test needs to finish in time. */
const READING_PACE: Record<number, number> = { 5: 120, 4: 150, 3: 200 };
const SECONDS_PER_QUESTION = 40;

/** Seconds to aim for on a passage: reading at exam pace plus time to answer. */
export function targetSeconds(p: Pick<Passage, 'chars' | 'level' | 'questions'>): number {
  return Math.round((p.chars / (READING_PACE[p.level] ?? 150)) * 60 + p.questions.length * SECONDS_PER_QUESTION);
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The shelf of reading passages, by level. */
export function Passages() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const [passages, setPassages] = useState<Passage[] | null>(null);
  useEffect(() => {
    loadPassages(pack.manifest.id).then(setPassages, () => setPassages([]));
  }, [pack]);
  const levels = [...new Set((passages ?? []).map((p) => p.level))].sort((a, b) => b - a);

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <Icon name="back" />
        </button>
        <h2 className="wordle-title">
          Timed reading <span className="jp faint">読解</span>
        </h2>
      </div>
      <p className="faint" style={{ margin: 0 }}>
        Notices, emails and essays like the JLPT reading section, with a target time. Read for the answer first; tap any sentence afterwards to
        see how it's built.
      </p>
      {levels.map((level) => (
        <div key={level} className="stack" style={{ gap: 8 }}>
          <div className="faint">
            N{level}
            {settings.levels.includes(level) ? '' : ' · not in your levels'}
          </div>
          <div className="list">
            {passages!
              .filter((p) => p.level === level)
              .map((p) => (
                <Link key={p.id} to={`/passages/${p.id}`} className="list-item">
                  <span className="term" lang="ja">
                    {p.title}
                  </span>
                  <span className="gloss">
                    {KIND_LABEL[p.kind].en} · {p.questions.length} {p.questions.length === 1 ? 'question' : 'questions'} · {clock(targetSeconds(p))}
                  </span>
                </Link>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One passage against the clock: read, answer every question, then check. The answers come with
 * why they are right, the translation, and the sentence breakdown for anything that was hard.
 */
export function PassageReader() {
  const { id } = useParams();
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const known = useKnown(pack);
  const [all, setAll] = useState<Passage[] | null>(null);
  const [picks, setPicks] = useState<(number | null)[]>([]);
  const [checked, setChecked] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const [usedSeconds, setUsedSeconds] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showEn, setShowEn] = useState(false);
  const top = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadPassages(pack.manifest.id).then(setAll, () => setAll([]));
    return () => stopSpeaking();
  }, [pack]);
  const passage = all?.find((p) => p.id === id);
  const sentences = useMemo(() => passage?.paragraphs.flat() ?? [], [passage]);

  useEffect(() => {
    if (!passage) return;
    setPicks(passage.questions.map(() => null));
    setChecked(false);
    setStartedAt(Date.now());
    setShowEn(false);
    setSelected(null);
  }, [passage]);

  useEffect(() => {
    if (checked) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [checked]);

  if (!all) return null;
  if (!passage) {
    return (
      <div className="empty">
        This passage was not found. <Link to="/passages">All passages</Link>
      </div>
    );
  }

  const target = targetSeconds(passage);
  const elapsed = checked ? usedSeconds : Math.max(0, Math.floor((now - startedAt) / 1000));
  const correct = passage.questions.filter((q, i) => picks[i] === q.answer).length;
  const say = (text: string) => speak(text, { locale: pack.manifest.ttsLocale, voiceURI: settings.voiceURI, rate: settings.speechRate });
  const next = all[all.indexOf(passage) + 1];

  function check() {
    const used = Math.floor((Date.now() - startedAt) / 1000);
    setUsedSeconds(used);
    setChecked(true);
    void logActivity(pack.manifest.id, 'passages', { score: correct, total: passage!.questions.length, minutes: Math.max(1, Math.round(used / 60)) }, settings);
    top.current?.scrollIntoView({ behavior: 'smooth' });
  }

  let n = 0;
  return (
    <div className="stack" ref={top}>
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/passages')} aria-label="All passages">
          <Icon name="close" />
        </button>
        <div className="progress-track" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${Math.min(100, (elapsed / target) * 100)}%` }} />
        </div>
        <span className={`mock-timer${elapsed > target ? ' low' : ''}`} aria-label={`${clock(elapsed)} of ${clock(target)}`}>
          {clock(elapsed)} / {clock(target)}
        </span>
      </div>

      {checked && (
        <div className="card center stack rise-in" style={{ gap: 4 }}>
          {correct === passage.questions.length && <Petals count={14} />}
          <div className="big-number">
            {correct}/{passage.questions.length}
          </div>
          <div className="faint">
            {elapsed <= target
              ? `In time: ${clock(elapsed)} of ${clock(target)}.`
              : `${clock(elapsed - target)} over the target. On the test, read the questions first, then read the text for them.`}
          </div>
        </div>
      )}

      <div className="faint">
        N{passage.level} · {KIND_LABEL[passage.kind].en} <span lang="ja">（{KIND_LABEL[passage.kind].jp}）</span>
      </div>
      <article className="passage reader" lang="ja">
        <div className="passage-title">{passage.title}</div>
        {passage.paragraphs.map((para, p) => (
          <p key={p}>
            {para.map((s) => {
              const index = n++;
              return (
                <span
                  key={index}
                  className={`lit-sentence${selected === index ? ' on' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(selected === index ? null : index)}
                >
                  <Ruby markup={s.r} mode={settings.furigana} knownKanji={known?.kanji} />
                </span>
              );
            })}
          </p>
        ))}
      </article>
      {checked && (
        <button className="memo-text" onClick={() => setShowEn((v) => !v)}>
          {showEn ? 'Hide the translation' : 'Show the translation'}
        </button>
      )}
      {checked && showEn && (
        <div className="card stack" style={{ gap: 6 }}>
          {passage.en.map((t, i) => (
            <p key={i} className="faint" style={{ margin: 0 }}>
              {t}
            </p>
          ))}
        </div>
      )}

      {passage.questions.map((q, qi) => (
        <div key={qi} className="card stack" style={{ gap: 8 }}>
          <div lang="ja" style={{ fontWeight: 600 }}>
            問{qi + 1}　{q.q}
          </div>
          <div className={`options${checked ? ' answered' : ''}`}>
            {q.options.map((o, oi) => {
              const state = !checked ? (picks[qi] === oi ? ' chosen' : '') : oi === q.answer ? ' correct' : picks[qi] === oi ? ' wrong' : '';
              return (
                <button
                  key={o}
                  className={`option jp${state}`}
                  style={{ '--i': oi } as CSSProperties}
                  lang="ja"
                  disabled={checked}
                  onClick={() => setPicks((p) => p.map((x, i) => (i === qi ? oi : x)))}
                >
                  {o}
                </button>
              );
            })}
          </div>
          {checked && <div className="faint">{q.why}</div>}
        </div>
      ))}

      {!checked ? (
        <button className="btn primary block" disabled={picks.some((p) => p === null)} onClick={check}>
          {picks.some((p) => p === null) ? `Answer all ${passage.questions.length} to check` : 'Check my answers'}
        </button>
      ) : (
        <div className="grid-2">
          <button
            className="btn"
            onClick={() => {
              setPicks(passage.questions.map(() => null));
              setChecked(false);
              setStartedAt(Date.now());
              setShowEn(false);
            }}
          >
            Try again
          </button>
          {next ? (
            <Link to={`/passages/${next.id}`} className="btn primary">
              Next passage
            </Link>
          ) : (
            <Link to="/passages" className="btn primary">
              All passages
            </Link>
          )}
        </div>
      )}

      {selected !== null && sentences[selected] && (
        <Breakdown
          key={selected}
          sentence={sentences[selected]}
          pack={pack}
          known={known}
          source={passage.title}
          onSpeak={(t) => void say(t || plainText(sentences[selected].r))}
          onClose={() => setSelected(null)}
          onPrev={selected > 0 ? () => setSelected(selected - 1) : undefined}
          onNext={selected < sentences.length - 1 ? () => setSelected(selected + 1) : undefined}
        />
      )}
    </div>
  );
}
