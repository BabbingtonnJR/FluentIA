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

      <Link to="/read" className="card link" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="jp" style={{ fontSize: '2rem', color: 'var(--accent)', lineHeight: 1 }} aria-hidden="true">
          読
        </div>
        <div style={{ flex: 1 }}>
          <strong>Daily reading</strong>
          <div className="faint">Real sentences built from the words you know, with furigana</div>
        </div>
      </Link>

      <div className="grid-2">
        <Link to="/listen" className="card link">
          <div className="jp" style={{ fontSize: '1.6rem', color: 'var(--indigo)' }}>
            聞
          </div>
          <strong>Hands-free</strong>
          <div className="faint">Audio review while you move</div>
        </Link>
        <Link to="/quiz" className="card link">
          <div className="jp" style={{ fontSize: '1.6rem', color: 'var(--indigo)' }}>
            試
          </div>
          <strong>Daily quiz</strong>
          <div className="faint">Meaning, reading, listening</div>
        </Link>
      </div>

      {pack.grammar.length > 0 && (
        <Link to="/mock" className="card link" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div className="jp" style={{ fontSize: '2rem', color: 'var(--indigo)', lineHeight: 1 }} aria-hidden="true">
            模
          </div>
          <div style={{ flex: 1 }}>
            <strong>JLPT mock test</strong>
            <div className="faint">Timed practice exam with all four sections</div>
          </div>
        </Link>
      )}

      <div className="section-title">Games · 遊び</div>
      <Link to="/wordle" className="card link" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="jp" style={{ fontSize: '2rem', color: 'var(--good)', lineHeight: 1 }} aria-hidden="true">
          言
        </div>
        <div style={{ flex: 1 }}>
          <strong>Wordle</strong>
          <div className="faint">Guess the 4-kana word of the day, with hints</div>
        </div>
      </Link>

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
          {sync.phase === 'signed-out' && (
            <Link to="/settings">Sign in to sync between your devices</Link>
          )}
          {sync.phase === 'syncing' && 'Syncing…'}
          {sync.phase === 'offline' && 'Offline — your progress is saved on this device'}
          {sync.phase === 'error' && `Sync error: ${sync.error}`}
          {sync.phase === 'idle' && sync.lastSyncedAt && `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}`}
        </div>
      )}
    </div>
  );
}
