import type { KanjiItem, Pack, PackManifest, VocabItem } from './types';

export const AVAILABLE_PACKS = ['ja'] as const;
export type PackId = (typeof AVAILABLE_PACKS)[number];

const cache = new Map<string, Promise<Pack>>();
const strokeCache = new Map<string, Promise<Record<string, string[]>>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json() as Promise<T>;
}

export function loadPack(id: string): Promise<Pack> {
  let p = cache.get(id);
  if (!p) {
    const base = `/packs/${id}`;
    p = Promise.all([
      getJson<PackManifest>(`${base}/manifest.json`),
      getJson<VocabItem[]>(`${base}/vocab.json`),
      getJson<KanjiItem[]>(`${base}/kanji.json`),
    ]).then(([manifest, vocab, kanji]) => ({
      manifest,
      vocab,
      kanji,
      vocabById: new Map(vocab.map((v) => [v.id, v])),
      kanjiById: new Map(kanji.map((k) => [k.id, k])),
    }));
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** Stroke paths (KanjiVG, 109×109 viewBox) are loaded separately since only the kanji page needs them. */
export function loadStrokes(id: string): Promise<Record<string, string[]>> {
  let p = strokeCache.get(id);
  if (!p) {
    p = getJson<Record<string, string[]>>(`/packs/${id}/strokes.json`);
    p.catch(() => strokeCache.delete(id));
    strokeCache.set(id, p);
  }
  return p;
}

/** KANJIDIC kun readings mark okurigana with a dot: "ひと.つ" → "ひと(つ)". */
export function formatKun(reading: string): string {
  const [stem, okurigana] = reading.split('.');
  return okurigana ? `${stem}(${okurigana})` : stem;
}

/** Vocabulary entries that use a given kanji, easiest level first. */
export function vocabWithKanji(pack: Pack, kanji: string, limit = 12): VocabItem[] {
  return pack.vocab
    .filter((v) => v.word.includes(kanji))
    .sort((a, b) => b.level - a.level)
    .slice(0, limit);
}
