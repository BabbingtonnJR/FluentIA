import { useMemo } from 'react';
import { parseRuby, showRuby, type FuriganaMode, type RubySegment } from '../reading/furigana';

const NO_KANJI: ReadonlySet<string> = new Set();

/** Splits segments into the parts before, inside and after [start, end) of the plain text. */
export function splitAt(segments: RubySegment[], [start, end]: [number, number]) {
  const parts: [RubySegment[], RubySegment[], RubySegment[]] = [[], [], []];
  let pos = 0;
  for (const seg of segments) {
    const from = pos;
    const to = pos + seg.text.length;
    pos = to;
    if (seg.ruby) {
      // A word with furigana is never split; it belongs wherever it overlaps the cloze.
      parts[to <= start ? 0 : from >= end ? 2 : 1].push(seg);
      continue;
    }
    const cut = (a: number, b: number) => seg.text.slice(Math.max(0, a - from), Math.max(0, b - from));
    const before = cut(from, Math.min(to, start));
    const inside = cut(Math.max(from, start), Math.min(to, end));
    const after = cut(Math.max(from, end), to);
    if (before) parts[0].push({ text: before });
    if (inside) parts[1].push({ text: inside });
    if (after) parts[2].push({ text: after });
  }
  return parts;
}

/**
 * Japanese text with furigana. With `cloze`, that span is either blanked out (`blank`) or
 * highlighted, for grammar cards.
 */
export function Ruby({
  markup,
  mode = 'all',
  knownKanji = NO_KANJI,
  cloze,
  blank = false,
}: {
  markup: string;
  mode?: FuriganaMode;
  knownKanji?: ReadonlySet<string>;
  cloze?: [number, number];
  blank?: boolean;
}) {
  const segments = useMemo(() => parseRuby(markup), [markup]);
  const render = (segs: RubySegment[], key: string) =>
    segs.map((seg, i) =>
      showRuby(seg, mode, knownKanji) ? (
        <ruby key={`${key}${i}`}>
          {seg.text}
          <rp>(</rp>
          <rt>{seg.ruby}</rt>
          <rp>)</rp>
        </ruby>
      ) : (
        <span key={`${key}${i}`}>{seg.text}</span>
      ),
    );

  if (!cloze) return <>{render(segments, 's')}</>;
  const [before, inside, after] = splitAt(segments, cloze);
  const length = cloze[1] - cloze[0];
  return (
    <>
      {render(before, 'b')}
      {blank ? (
        <span className="cloze-blank" style={{ width: `${Math.max(2, length) * 0.9}em` }} aria-label="blank" />
      ) : (
        <mark className="cloze">{render(inside, 'i')}</mark>
      )}
      {render(after, 'a')}
    </>
  );
}
