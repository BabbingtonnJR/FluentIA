import { useEffect, useMemo, useState } from 'react';
import type { Pack } from '../content/types';
import { db } from '../db/db';
import { State } from '../srs/scheduler';

export interface Known {
  /** Indexes into pack.vocab of words studied at least once. */
  words: Set<number>;
  /** Kanji studied at least once (for "furigana on unknown kanji only"). */
  kanji: Set<string>;
}

/** What the learner has studied, read once per visit so the page doesn't shift while reading. */
export function useKnown(pack: Pack): Known | null {
  const [known, setKnown] = useState<Known | null>(null);
  const lang = pack.manifest.id;
  const vocabIndex = useMemo(() => new Map(pack.vocab.map((v, i) => [v.id, i])), [pack]);
  useEffect(() => {
    let alive = true;
    db.cards
      .where('[lang+due]')
      .between([lang, -Infinity], [lang, Infinity])
      .filter((c) => c.state !== State.New)
      .toArray()
      .then((cards) => {
        if (!alive) return;
        const words = new Set<number>();
        const kanji = new Set<string>();
        for (const c of cards) {
          if (c.kind === 'kanji') kanji.add(c.itemId);
          else if (c.kind === 'vocab' && vocabIndex.has(c.itemId)) words.add(vocabIndex.get(c.itemId)!);
        }
        setKnown({ words, kanji });
      });
    return () => {
      alive = false;
    };
  }, [lang, vocabIndex]);
  return known;
}
