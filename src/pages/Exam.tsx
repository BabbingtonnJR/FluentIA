import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import { saveSettings } from '../db/repo';
import type { Settings } from '../db/types';
import { usePack, useSettings } from '../hooks';
import { SECTIONS } from '../quiz/mock';
import { examPlan, nextJlptDate, REVIEW_DAYS, type KindProgress } from '../stats/plan';

/** The level aimed for: the one chosen, or the hardest level being studied. */
export function examLevelOf(settings: Settings): number {
  return settings.examLevel ?? (settings.levels.length ? Math.min(...settings.levels) : 4);
}

export const examDateOf = (settings: Settings, now = new Date()) => settings.examDate ?? nextJlptDate(now);

const MAX_NEW_PER_DAY = 50;

const longDate = (d: string | number) =>
  new Date(typeof d === 'string' ? `${d}T12:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Where to go to work on each section of the test. */
const SECTION_HELP: Record<string, { to: string; what: string }> = {
  vocab: { to: '/study', what: 'more new words a day, and the Wordle and crossword' },
  grammar: { to: '/practice', what: 'Practice drills on the points you mix up' },
  reading: { to: '/passages', what: 'a timed passage a day' },
  listening: { to: '/speak/responses', what: 'quick replies and hands-free listening' },
};

/**
 * The plan to the next JLPT (試験): days left, how much of the level is still unseen, how many new
 * items a day that takes, whether the current pace gets there, and what the mock tests say to
 * work on.
 */
export function Exam() {
  const pack = usePack();
  const settings = useSettings();
  const navigate = useNavigate();
  const lang = pack.manifest.id;
  const level = examLevelOf(settings);
  const date = examDateOf(settings);

  const data = useLiveQuery(async () => {
    const cards = await db.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).toArray();
    const reviews = await db.reviews.where('[lang+reviewedAt]').between([lang, Date.now() - 15 * 86_400_000], [lang, Infinity]).toArray();
    const mocks = (await db.activities.where('[lang+day]').between([lang, ''], [lang, '￿']).toArray())
      .filter((a) => a.type === 'mock' && a.detail?.level === level)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
    return { plan: examPlan(pack, cards, reviews, level, date), mocks };
  }, [pack, level, date]);
  if (!data) return null;
  const { plan, mocks } = data;

  const levels = pack.manifest.levels.map((l) => l.id).sort((a, b) => b - a);
  const reviewFrom = new Date(`${date}T12:00:00`).getTime() - REVIEW_DAYS * 86_400_000;
  const onTrack = plan.finishAt !== null && plan.finishAt <= reviewFrom;
  // More than this a day piles up reviews faster than anyone can do them.
  const wordsPerDay = Math.min(plan.wordsPerDay, MAX_NEW_PER_DAY);
  const planned = settings.newPerDay === wordsPerDay && settings.grammarPerDay === plan.grammarPerDay;
  const heavy = plan.wordsPerDay > 40;

  // Section averages over the recent mocks, weakest first.
  const sections = SECTIONS.map((s) => {
    const scores = mocks.flatMap((m) => {
      const r = m.detail?.sections[s.id];
      return r && r[1] ? [r[0] / r[1]] : [];
    });
    return { ...s, avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
  })
    .filter((s) => s.avg !== null)
    .sort((a, b) => a.avg! - b.avg!);
  const weakest = sections[0];

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back">
          <Icon name="back" />
        </button>
        <h2 className="wordle-title">
          JLPT plan <span className="jp faint">試験</span>
        </h2>
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <div className="field">
          <span className="label">Level</span>
          <div className="segmented" role="group">
            {levels.map((l) => (
              <button key={l} className={l === level ? 'on' : ''} onClick={() => void saveSettings({ examLevel: l })}>
                N{l}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="label">Exam day</span>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => void saveSettings({ examDate: e.target.value || null })}
            aria-describedby="exam-date-help"
          />
          <span id="exam-date-help" className="faint">
            The JLPT is on the first Sunday of July and December.
            {settings.examDate && (
              <>
                {' '}
                <button className="memo-text" onClick={() => void saveSettings({ examDate: null })}>
                  Use the next one
                </button>
              </>
            )}
          </span>
        </label>
      </div>

      <div className="card center stack" style={{ gap: 2 }}>
        <div className="big-number" style={{ color: 'var(--accent)' }}>
          {plan.daysLeft}
        </div>
        <div className="stat-label">days to N{level}</div>
        <div className="faint">{longDate(date)}</div>
      </div>

      <div className="section-title">What N{level} covers · 範囲</div>
      <div className="card stack" style={{ gap: 10 }}>
        <Coverage label="Words" p={plan.words} />
        <Coverage label="Kanji" p={plan.kanji} />
        <Coverage label="Grammar" p={plan.grammar} />
        <div className="faint">Includes the easier levels: the exam assumes them.</div>
      </div>

      <div className="section-title">Daily new items · 毎日</div>
      <div className="card stack" style={{ gap: 10 }}>
        {plan.daysLeft <= REVIEW_DAYS ? (
          <p style={{ margin: 0 }}>The last week is for reviews and mock tests, not new cards. Do one mock a day and go over your weak spots.</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              To see everything by {longDate(reviewFrom)} and keep the last week for review: <b>{plan.wordsPerDay} words &amp; kanji</b> and{' '}
              <b>
                {plan.grammarPerDay} grammar {plan.grammarPerDay === 1 ? 'point' : 'points'}
              </b>{' '}
              a day.
            </p>
            {heavy && (
              <div className="notice">
                That's a lot. Tap "I already know this" on new cards you know (or mark a whole level known in Settings), so the plan counts only what's new to you, and lean on the mock
                tests to find the gaps.
              </div>
            )}
            {planned ? (
              <div className="faint">Your daily limits already follow this plan.</div>
            ) : (
              <button className="btn primary block" onClick={() => void saveSettings({ newPerDay: wordsPerDay, grammarPerDay: plan.grammarPerDay })}>
                {wordsPerDay < plan.wordsPerDay ? `Use ${wordsPerDay} + ${plan.grammarPerDay} a day, the most that stays doable` : 'Use this plan'} (now {settings.newPerDay} + {settings.grammarPerDay} a day)
              </button>
            )}
          </>
        )}
        <div className="faint">
          {plan.pace > 0
            ? `Last two weeks: ${plan.pace.toFixed(1)} new a day. ${
                onTrack
                  ? `At this pace you see everything by ${longDate(plan.finishAt!)}. On track.`
                  : `At this pace you'd finish ${plan.finishAt ? `around ${longDate(plan.finishAt)}` : 'after the exam'}.`
              }`
            : 'No new cards in the last two weeks yet.'}
        </div>
      </div>

      <div className="section-title">Mock tests · 模試</div>
      <div className="card stack" style={{ gap: 10 }}>
        {mocks.length ? (
          <>
            {sections.map((s) => (
              <div key={s.id} className="spread">
                <span>
                  <span className="jp">{s.jp}</span> <span className="faint">{s.label}</span>
                </span>
                <strong>{Math.round(s.avg! * 100)}%</strong>
              </div>
            ))}
            {weakest && (
              <p className="faint" style={{ margin: 0 }}>
                Weakest: {weakest.label.toLowerCase()}. Try <Link to={SECTION_HELP[weakest.id].to}>{SECTION_HELP[weakest.id].what}</Link>.
              </p>
            )}
          </>
        ) : (
          <p className="faint" style={{ margin: 0 }}>
            No N{level} mock yet. Take one to see where you stand; it shows which section to work on.
          </p>
        )}
        <Link to="/mock" className="btn block">
          Take a mock test
        </Link>
      </div>

      <div className="section-title">A day of study · 一日</div>
      <div className="card stack" style={{ gap: 6 }}>
        <Link to="/study">1. Study session: reviews first, then new cards</Link>
        <Link to="/speak/responses">2. One round of quick replies, out loud</Link>
        <Link to="/passages">3. One timed reading passage</Link>
        <Link to="/listen">4. Hands-free while you move</Link>
        <span className="faint">And a mock test every week, every day in the last one.</span>
      </div>
    </div>
  );
}

function Coverage({ label, p }: { label: string; p: KindProgress }) {
  const pct = p.total ? p.seen / p.total : 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread">
        <span>{label}</span>
        <span className="faint">
          {p.seen} / {p.total} · {Math.round(pct * 100)}%
        </span>
      </div>
      <div className="xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.seen} aria-label={label}>
        <div className="xp-fill" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
