import type { Pack } from '../content/types';
import type { ActivityRecord, CardRecord, ReviewRecord } from '../db/types';
import { dayKey, shiftDay } from '../lib/time';
import { isMature, Rating, State } from '../srs/scheduler';

export interface Streak {
  current: number;
  best: number;
  doneToday: boolean;
}

/** A day counts toward the streak if anything was studied. Today not being done yet does not break it. */
export function computeStreak(days: Set<string>, today: string): Streak {
  const doneToday = days.has(today);
  let current = 0;
  for (let d = doneToday ? today : shiftDay(today, -1); days.has(d); d = shiftDay(d, -1)) current++;

  let best = 0;
  for (const d of days) {
    if (days.has(shiftDay(d, -1))) continue; // only start counting at the first day of a run
    let run = 0;
    for (let x = d; days.has(x); x = shiftDay(x, 1)) run++;
    best = Math.max(best, run);
  }
  return { current, best, doneToday };
}

export function studyDays(reviews: ReviewRecord[], activities: ActivityRecord[], startHour: number): Set<string> {
  const days = new Set(reviews.map((r) => dayKey(r.reviewedAt, startHour)));
  for (const a of activities) days.add(a.day);
  return days;
}

export interface DayCount {
  day: string;
  reviews: number;
  learned: number;
}

export function reviewsPerDay(reviews: ReviewRecord[], today: string, days: number, startHour: number): DayCount[] {
  const out = new Map<string, DayCount>();
  for (let i = days - 1; i >= 0; i--) {
    const day = shiftDay(today, -i);
    out.set(day, { day, reviews: 0, learned: 0 });
  }
  for (const r of reviews) {
    const entry = out.get(dayKey(r.reviewedAt, startHour));
    if (!entry) continue;
    if (r.prevState === State.New) entry.learned++;
    else entry.reviews++;
  }
  return [...out.values()];
}

/** Reviews coming due on each of the next `days` days; overdue cards count for today. */
export function forecast(cards: CardRecord[], today: string, days: number, startHour: number): { day: string; due: number }[] {
  const out = Array.from({ length: days }, (_, i) => ({ day: shiftDay(today, i), due: 0 }));
  const index = new Map(out.map((d, i) => [d.day, i]));
  for (const c of cards) {
    const key = dayKey(c.due, startHour);
    const i = key <= today ? 0 : index.get(key);
    if (i !== undefined) out[i].due++;
  }
  return out;
}

/** Share of mature-ish reviews (cards already in Review) that were remembered. */
export function retention(reviews: ReviewRecord[]): number | null {
  const relevant = reviews.filter((r) => r.prevState === State.Review);
  if (!relevant.length) return null;
  return relevant.filter((r) => r.rating !== Rating.Again).length / relevant.length;
}

export function computeXp(reviews: ReviewRecord[], activities: ActivityRecord[]): number {
  let xp = 0;
  for (const r of reviews) xp += r.prevState === State.New ? 3 : 1;
  // Quiz answers and sentences read count by score; hands-free listening by minutes.
  for (const a of activities) xp += a.type === 'handsfree' ? a.minutes * 2 : a.score * 2;
  return xp;
}

/** Level n needs 50·n² XP in total, so early levels come quickly and later ones take steady work. */
export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  while (xp >= 50 * level * level) level++;
  const prev = level === 1 ? 0 : 50 * (level - 1) * (level - 1);
  return { level, into: xp - prev, needed: 50 * level * level - prev };
}

export type CardStatus = 'unseen' | 'learning' | 'young' | 'mature';

export function cardStatus(c: CardRecord | undefined): CardStatus {
  if (!c || c.state === State.New) return 'unseen';
  if (c.state !== State.Review) return 'learning';
  return isMature(c) ? 'mature' : 'young';
}

export interface LevelBreakdown {
  level: number;
  label: string;
  total: number;
  unseen: number;
  learning: number;
  young: number;
  mature: number;
}

/** Progress per JLPT level, counting recognition cards only (one per item). */
export function levelBreakdown(pack: Pack, cards: CardRecord[]): LevelBreakdown[] {
  const recognition = new Map(cards.filter((c) => c.direction === 'recognition').map((c) => [c.id, c]));
  return pack.manifest.levels.map(({ id: level, label }) => {
    const ids = [
      ...pack.vocab.filter((v) => v.level === level).map((v) => `${pack.manifest.id}:vocab:recognition:${v.id}`),
      ...pack.kanji.filter((k) => k.level === level).map((k) => `${pack.manifest.id}:kanji:recognition:${k.id}`),
      ...pack.grammar.filter((g) => g.level === level).map((g) => `${pack.manifest.id}:grammar:recognition:${g.id}`),
    ];
    const row: LevelBreakdown = { level, label, total: ids.length, unseen: 0, learning: 0, young: 0, mature: 0 };
    for (const id of ids) row[cardStatus(recognition.get(id))]++;
    return row;
  });
}
