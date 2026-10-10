/**
 * Per-browser conveniences (a game in progress, a last-used option). Storage can be missing or
 * blocked (private mode), so failures are ignored and callers fall back to defaults.
 */
export function loadLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not saved: the page still works, it just won't remember */
  }
}
