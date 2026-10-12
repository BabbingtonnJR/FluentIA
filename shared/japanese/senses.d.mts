// Types for senses.mjs, which is plain JavaScript so the Node build scripts can run it directly.
export function wordKey(word: string): string;
export function normReading(reading: string): string;
export function alignReading(
  word: string,
  reading: string,
  readings: (kanji: string) => string[],
): { kanji: string; reading: string }[] | null;
