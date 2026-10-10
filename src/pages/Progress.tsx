import { useLiveQuery } from 'dexie-react-hooks';
import type { CSSProperties } from 'react';
import { BarChart } from '../components/BarChart';
import { CountUp } from '../components/CountUp';
import { db } from '../db/db';
import { usePack, useSettings } from '../hooks';
import { DAY, dayKey, dayStart } from '../lib/time';
import { State } from '../srs/scheduler';
import {
  computeStreak,
  computeXp,
  forecast,
  levelBreakdown,
  levelFromXp,
  retention,
  reviewsPerDay,
  studyDays,
} from '../stats/stats';

const STAGES = [
  { key: 'mature', label: 'Mature' },
  { key: 'young', label: 'Young' },
  { key: 'learning', label: 'Learning' },
  { key: 'unseen', label: 'Not studied' },
] as const;

export function Progress() {
  const pack = usePack();
  const settings = useSettings();
  const lang = pack.manifest.id;

  const data = useLiveQuery(async () => {
    const now = Date.now();
    const cards = await db.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).toArray();
    const reviews = await db.reviews.where('[lang+reviewedAt]').between([lang, -Infinity], [lang, Infinity]).toArray();
    const activities = await db.activities.where('[lang+day]').between([lang, ''], [lang, '￿']).toArray();
    const today = dayKey(now, settings.dayStartHour);
    const monthAgo = dayStart(now, settings.dayStartHour) - 29 * DAY;
    return {
      today,
      cards,
      streak: computeStreak(studyDays(reviews, activities, settings.dayStartHour), today),
      xp: computeXp(reviews, activities),
      retention: retention(reviews.filter((r) => r.reviewedAt >= monthAgo)),
      perDay: reviewsPerDay(reviews, today, 30, settings.dayStartHour),
      forecast: forecast(cards.filter((c) => c.state !== State.New), today, 14, settings.dayStartHour),
      totalReviews: reviews.length,
    };
  }, [lang, settings.dayStartHour]);

  if (!data) return null;
  const breakdown = levelBreakdown(pack, data.cards);
  const level = levelFromXp(data.xp);
  const known = breakdown.reduce((s, b) => s + b.total - b.unseen, 0);
  const unseenEnabled = breakdown.filter((b) => settings.levels.includes(b.level)).reduce((s, b) => s + b.unseen, 0);
  const daysLeft = settings.newPerDay > 0 ? Math.ceil(unseenEnabled / settings.newPerDay) : Infinity;
  const finish = new Date(Date.now() + daysLeft * DAY).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const levelsLabel = breakdown
    .filter((b) => settings.levels.includes(b.level))
    .map((b) => b.label)
    .join(' + ');

  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          Progress<span className="kanji-mark">進歩</span>
        </h1>
      </header>

      <div className="grid-2">
        <div className="card">
          <div className="big-number">
            <CountUp value={data.streak.current} />
          </div>
          <div className="stat-label">day streak · best {data.streak.best}</div>
        </div>
        <div className="card">
          <div className="big-number">
            <CountUp value={known} />
          </div>
          <div className="stat-label">words & kanji started</div>
        </div>
        <div className="card">
          <div className="big-number">{data.retention === null ? '—' : <CountUp value={Math.round(data.retention * 100)} suffix="%" />}</div>
          <div className="stat-label">retention, last 30 days</div>
        </div>
        <div className="card">
          <div className="big-number">
            Lv <CountUp value={level.level} />
          </div>
          <div className="stat-label">
            {data.xp} XP · {data.totalReviews} reviews
          </div>
        </div>
      </div>

      <div className="section-title">Road to N3 · 道</div>
      <div className="card stack">
        <div className="legend">
          {STAGES.map((s) => (
            <span key={s.key} style={{ '--c': `var(--${s.key})` } as CSSProperties}>
              {s.label}
            </span>
          ))}
        </div>
        {breakdown.map((b) => (
          <div key={b.level} className="stack" style={{ gap: 4 }}>
            <div className="spread">
              <strong>{b.label}</strong>
              <span className="faint">
                {b.total - b.unseen} / {b.total} started · {b.mature} mature
              </span>
            </div>
            <div
              className="stacked-bar"
              role="img"
              aria-label={`${b.label}: ${b.mature} mature, ${b.young} young, ${b.learning} learning, ${b.unseen} not studied`}
            >
              {STAGES.filter((s) => s.key !== 'unseen').map((s) =>
                b[s.key] > 0 ? (
                  <div key={s.key} style={{ width: `${(b[s.key] / b.total) * 100}%`, background: `var(--${s.key})` }} title={`${s.label}: ${b[s.key]}`} />
                ) : null,
              )}
            </div>
          </div>
        ))}
        {levelsLabel && (
          <p className="faint" style={{ margin: 0 }}>
            {unseenEnabled === 0
              ? `You have started every card in ${levelsLabel}.`
              : `${unseenEnabled} cards left in ${levelsLabel}. At ${settings.newPerDay} new per day you will have seen them all by ${finish}.`}
          </p>
        )}
      </div>

      <div className="section-title">Last 30 days</div>
      <div className="card">
        <BarChart
          title="Cards studied per day over the last 30 days"
          data={data.perDay.map((d) => ({ label: d.day, values: [d.reviews, d.learned] }))}
          series={[
            { name: 'Reviews', color: 'var(--series-reviews)' },
            { name: 'Learned', color: 'var(--series-learned)' },
          ]}
        />
      </div>

      <div className="section-title">Upcoming reviews</div>
      <div className="card">
        <BarChart
          title="Reviews due on each of the next 14 days"
          data={data.forecast.map((d) => ({ label: d.day, values: [d.due] }))}
          series={[{ name: 'Due', color: 'var(--series-reviews)' }]}
          defaultIndex={0}
        />
      </div>
    </div>
  );
}
