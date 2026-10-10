export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Study-day key (YYYY-MM-DD, local time). A day starts at `startHour`,
 * so a review at 1am still counts for the previous day.
 */
export function dayKey(ts: number, startHour = 4): string {
  const d = new Date(ts - startHour * HOUR);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Epoch ms when the study day containing `ts` began. */
export function dayStart(ts: number, startHour = 4): number {
  const d = new Date(ts - startHour * HOUR);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + startHour * HOUR;
}

/** The day key `offset` days before/after the given key. */
export function shiftDay(key: string, offset: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + offset, 12);
  return dayKey(date.getTime(), 0);
}

export function formatInterval(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export function uid(): string {
  return crypto.randomUUID();
}
