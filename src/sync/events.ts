// Tiny pub/sub so the sync engine can push soon after local writes without the
// data layer importing the sync code.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyLocalChange(): void {
  for (const fn of listeners) fn();
}
