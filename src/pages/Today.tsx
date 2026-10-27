import { useLiveQuery } from 'dexie-react-hooks';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { CountUp } from '../components/CountUp';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import { buildSession } from '../db/repo';
import { usePack, useSettings } from '../hooks';
import { dayKey, dayStart } from '../lib/time';
import { State } from '../srs/scheduler';
import { dailyQuests } from '../stats/quests';
import { computeStreak, computeXp, levelFromXp, studyDays } from '../stats/stats';
import { useSyncStatus } from '../sync/sync';
import { leeches, openMistakes } from '../study/weak';
import { examDateOf, examLevelOf } from './Exam';

export function Today() {
  const pack = usePack();
  const settings = useSettings();
  const lang = pack.manifest.id;
  const sync = useSyncStatus();

  const data = useLiveQuery(async () => {
    const now = Date.now();
    const session = await buildSession(pack, settings, now);
    const reviews = await db.reviews.where('[lang+reviewedAt]').between([lang, -Infinity], [lang, Infinity]).toArray();
    const activities = await db.activities.where('[lang+day]').between([lang, ''], [lang, '￿']).toArray();
    const today = dayKey(now, settings.dayStartHour);
    const start = dayStart(now, settings.dayStartHour);
    const todays = reviews.filter((r) => r.reviewedAt >= start);
    return {
      session,
      today,
      streak: computeStreak(studyDays(reviews, activities, settings.dayStartHour), today),
      xp: computeXp(reviews, activities),
      reviewedToday: todays.filter((r) => r.prevState !== State.New).length,
      learnedToday: todays.filter((r) => r.prevState === State.New).length,
      activitiesToday: activities.filter((a) => a.day === today),
      weak: (await openMistakes(lang)).length + leeches(await db.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).toArray()).length,
    };
  }, [pack, settings]);

  if (!data) return null;
  const { session, streak } = data;
  const level = levelFromXp(data.xp);
  const quests = dailyQuests({
    dueNow: session.dueCount,
    reviewedToday: data.reviewedToday,
    learnedToday: data.learnedToday,
    newLeft: session.newCount,
    newPerDay: settings.newPerDay,
    activitiesToday: data.activitiesToday,
  });
  const total = session.queue.length;
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'おはよう' : hour < 18 ? 'こんにちは' : 'こんばんは';

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <div className="faint jp">{greeting}</div>
          <h1>
            Today<span className="kanji-mark">今日</span>
          </h1>
        </div>
        <div className="center" title={`Best streak: ${streak.best} days`}>
          <div className={`big-number${streak.doneToday ? ' lit' : ''}`} style={{ color: streak.doneToday ? 'var(--accent)' : 'var(--ink-3)' }}>
            <CountUp value={streak.current} />
          </div>
          <div className="stat-label">day streak</div>
        </div>
      </header>

      <ExamCountdown level={examLevelOf(settings)} date={examDateOf(settings)} />

      <Link to="/study" className="card link hero">
        <div className="stat-label">Study session</div>
        <div className="row" style={{ alignItems: 'baseline', gap: 20, margin: '6px 0 14px' }}>
          <div>
            <div className="big-number">
              <CountUp value={session.dueCount} />
            </div>
            <div className="stat-label">reviews</div>
          </div>
          <div>
            <div className="big-number" style={{ color: 'var(--accent)' }}>
              <CountUp value={session.newCount} />
            </div>
            <div className="stat-label">new</div>
          </div>
        </div>
        <span className="btn primary block">{total ? 'Start studying' : 'All caught up'}</span>
      </Link>

      <div className="section-title">Practice · 練習</div>
      <div className="tiles">
        <Tile to="/speak" jp="話" title="Speak" hint="Role-plays, quick replies" tone="accent" />
        <Tile to="/listen" jp="聞" title="Hands-free" hint="Audio while you move" />
        <Tile to="/quiz" jp="試" title="Daily quiz" hint="10 quick questions" />
        <Tile to="/practice" jp="練" title="Practice" hint="Drill what you pick" />
        {data.weak > 0 && <Tile to="/weak" jp="弱" title={`Weak spots · ${data.weak}`} hint="Mistakes, tricky cards" tone="warn" />}
      </div>

      <div className="section-title">JLPT · 試験</div>
      <div className="tiles">
        {pack.grammar.length > 0 && <Tile to="/mock" jp="模" title="Mock test" hint="All four sections, timed" />}
        <Tile to="/passages" jp="解" title="Timed reading" hint="Like the reading section" />
      </div>

      <div className="section-title">Read · 読む</div>
      <div className="tiles">
        <Tile to="/read" jp="読" title="Daily reading" hint="Sentences from your words" tone="accent" />
        <Tile to="/literature" jp="文" title="Literature" hint="Stories, comics, videos" />
      </div>

      <div className="section-title">Games · 遊び</div>
      <div className="tiles">
        <Tile to="/wordle" jp="言" title="Wordle" hint="Guess the kana word" tone="good" />
        <Tile to="/crossword" jp="交" title="Crossword" hint="Daily, by level" tone="good" />
      </div>

      <div className="section-title">Daily activities · 毎日</div>
      <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {quests.map((q, n) => (
          <Link
            key={q.id}
            to={q.to}
            className={`quest${q.done ? ' done' : ''}`}
            style={{ textDecoration: 'none', '--i': n } as CSSProperties}
          >
            <span className="check">{q.done && <Icon name="check" />}</span>
            <span style={{ flex: 1 }}>
              <div className="quest-title" style={{ fontWeight: 600 }}>
                {q.title}
              </div>
              <div className="faint">{q.detail}</div>
            </span>
          </Link>
        ))}
      </div>

      <div className="section-title">Level · レベル</div>
      <div className="card stack" style={{ gap: 8 }}>
        <div className="spread">
          <strong>Level {level.level}</strong>
          <span className="faint">
            {level.into} / {level.needed} XP
          </span>
        </div>
        <div className="xp-track" role="progressbar" aria-valuemin={0} aria-valuemax={level.needed} aria-valuenow={level.into}>
          <div className="xp-fill" style={{ width: `${(level.into / level.needed) * 100}%` }} />
        </div>
      </div>

      {sync.phase !== 'unconfigured' && (
        <div className="faint center">
          {sync.phase === 'syncing' && 'Syncing…'}
          {sync.phase === 'offline' && 'Offline — your progress is saved on this device'}
          {sync.phase === 'error' && `Sync error: ${sync.error}`}
          {sync.phase === 'idle' && sync.lastSyncedAt && `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}`}
        </div>
      )}
    </div>
  );
}

/** Days to the exam, as a slim link to the plan. */
function ExamCountdown({ level, date }: { level: number; date: string }) {
  const days = Math.max(0, Math.ceil((new Date(`${date}T09:00:00`).getTime() - Date.now()) / 86_400_000));
  return (
    <Link to="/exam" className="card link exam-countdown" style={{ display: 'flex' }}>
      <span className="jp" aria-hidden="true">
        験
      </span>
      <span style={{ flex: 1 }}>
        <strong>
          JLPT N{level} in {days} {days === 1 ? 'day' : 'days'}
        </strong>
        <span className="faint"> · your plan</span>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}

/** A compact link to an activity: its kanji, name and a few words on what it is. */
function Tile({ to, jp, title, hint, tone = 'indigo' }: { to: string; jp: string; title: string; hint: string; tone?: 'accent' | 'indigo' | 'good' | 'warn' }) {
  return (
    <Link to={to} className="card link tile">
      <span className="jp tile-jp" style={{ color: `var(--${tone})` }} aria-hidden="true">
        {jp}
      </span>
      <strong>{title}</strong>
      <span className="faint">{hint}</span>
    </Link>
  );
}
