import { useEffect, useState } from 'react';
import { loadStrokes } from '../content/packs';

const STROKE_SECONDS = 0.55;

/** Animated stroke order from KanjiVG paths (109×109 viewBox). */
export function StrokeOrder({ lang, char, run }: { lang: string; char: string; run: number }) {
  const [paths, setPaths] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadStrokes(lang).then(
      (all) => alive && setPaths(all[char] ?? []),
      () => alive && setPaths([]),
    );
    return () => {
      alive = false;
    };
  }, [lang, char]);

  if (!paths) return <div className="stroke-box" />;
  if (!paths.length) return <div className="stroke-box empty faint">No stroke data</div>;

  return (
    <svg className="stroke-box" viewBox="0 0 109 109" role="img" aria-label={`Stroke order for ${char}, ${paths.length} strokes`}>
      <style>{`
        @keyframes draw { from { stroke-dashoffset: 1; opacity: 1; } to { stroke-dashoffset: 0; opacity: 1; } }
        /* hidden until its turn, otherwise round line caps show as dots */
        .stroke-anim { stroke-dasharray: 1; stroke-dashoffset: 1; opacity: 0; animation: draw ${STROKE_SECONDS}s ease forwards; }
        @media (prefers-reduced-motion: reduce) { .stroke-anim { stroke-dashoffset: 0; opacity: 1; animation: none; } }
      `}</style>
      <g stroke="var(--line)" strokeWidth="3.5">
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g key={run} stroke="var(--ink)" strokeWidth="3.5">
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            pathLength={1}
            className="stroke-anim"
            style={{ animationDelay: `${i * STROKE_SECONDS}s`, stroke: i === 0 ? 'var(--accent)' : undefined }}
          />
        ))}
      </g>
    </svg>
  );
}
