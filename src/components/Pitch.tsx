import { useEffect, useState } from 'react';
import { loadPitch, type PitchData } from '../content/packs';

/** Small kana join the mora before them: きょ is one mora, っ ー ん are each one. */
export function morae(kana: string): string[] {
  const out: string[] = [];
  for (const c of kana) {
    if (/[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/.test(c) && out.length) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}

/**
 * High or low for each mora of an accent phrase, Tokyo style: the first mora is low unless the
 * accent is on it, the pitch then stays high up to the accented mora and drops after it. Accent 0
 * (or the last mora) means no drop inside the word.
 */
export function pitchPattern(count: number, accent: number): ('hi' | 'lo')[] {
  return Array.from({ length: count }, (_, i) => {
    if (accent === 1) return i === 0 ? 'hi' : 'lo';
    if (i === 0) return count === 1 ? 'hi' : 'lo';
    return accent === 0 || i < accent ? 'hi' : 'lo';
  });
}

/** The pitch accents, loaded once; empty until (or unless) they exist. */
export function usePitch(lang: string): PitchData {
  const [data, setData] = useState<PitchData>({});
  useEffect(() => {
    let alive = true;
    void loadPitch(lang).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [lang]);
  return data;
}

/**
 * A reading with its pitch drawn over it: a line over the high morae, a step where the pitch
 * rises or falls. Plain text when the accent is unknown or doesn't match the reading.
 */
export function PitchReading({ reading, phrases, className }: { reading: string; phrases?: [number, number][]; className?: string }) {
  const all = morae(reading);
  if (!phrases?.length || phrases.reduce((n, [c]) => n + c, 0) !== all.length) {
    return (
      <span className={className} lang="ja">
        {reading}
      </span>
    );
  }
  let at = 0;
  return (
    <span className={`pitch ${className ?? ''}`} lang="ja" aria-label={reading}>
      {phrases.map(([count, accent], p) => {
        const pattern = pitchPattern(count, accent);
        const ms = all.slice(at, (at += count));
        return (
          <span key={p} className="pitch-phrase" aria-hidden="true">
            {ms.map((m, i) => (
              <span
                key={i}
                className={`mora ${pattern[i]}${pattern[i] === 'hi' && pattern[i + 1] === 'lo' ? ' drop' : ''}${i > 0 && pattern[i] === 'hi' && pattern[i - 1] === 'lo' ? ' rise' : ''}`}
              >
                {m}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}
