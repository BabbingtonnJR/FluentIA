import type { GrammarPoint, KanjiItem, LitIndexEntry, LitWork, Pack, PackManifest, Sentence, VocabItem } from './types';

export const AVAILABLE_PACKS = ['ja'] as const;
export type PackId = (typeof AVAILABLE_PACKS)[number];

const cache = new Map<string, Promise<Pack>>();
const strokeCache = new Map<string, Promise<Record<string, string[]>>>();
const sentenceCache = new Map<string, Promise<Sentence[]>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json() as Promise<T>;
}

export function loadPack(id: string): Promise<Pack> {
  let p = cache.get(id);
  if (!p) {
    const base = `/packs/${id}`;
    p = getJson<PackManifest>(`${base}/manifest.json`).then((manifest) =>
      Promise.all([
        getJson<VocabItem[]>(`${base}/vocab.json`),
        getJson<KanjiItem[]>(`${base}/kanji.json`),
        manifest.kinds.includes('grammar') ? getJson<GrammarPoint[]>(`${base}/grammar.json`) : Promise.resolve([]),
      ]).then(([vocab, kanji, grammar]) => ({
        manifest,
        vocab,
        kanji,
        grammar,
        vocabById: new Map(vocab.map((v) => [v.id, v])),
        kanjiById: new Map(kanji.map((k) => [k.id, k])),
        grammarById: new Map(grammar.map((g) => [g.id, g])),
      })),
    );
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

/** Reading sentences are loaded separately since only the reading page needs them. */
export function loadSentences(id: string): Promise<Sentence[]> {
  let p = sentenceCache.get(id);
  if (!p) {
    p = getJson<Sentence[]>(`/packs/${id}/sentences.json`);
    p.catch(() => sentenceCache.delete(id));
    sentenceCache.set(id, p);
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

const litIndexCache = new Map<string, Promise<LitIndexEntry[]>>();
const litWorkCache = new Map<string, Promise<LitWork>>();

function cached<T>(cache: Map<string, Promise<T>>, key: string, url: string): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = getJson<T>(url);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** The literature shelf: stories with their metadata (literature/index.json). */
export const loadLiteratureIndex = (lang: string) => cached(litIndexCache, lang, `/packs/${lang}/literature/index.json`);

/** One story with its sentences and word breakdowns, loaded when opened. */
export const loadLiteratureWork = (lang: string, id: string) => cached(litWorkCache, `${lang}/${id}`, `/packs/${lang}/literature/${id}.json`);
