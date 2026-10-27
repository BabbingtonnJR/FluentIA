import type { CSSProperties } from 'react';

/**
 * The learner's tree, drawn for its stage: a seed in the soil, a sprout, a seedling, a young tree,
 * a full tree, and a cherry tree in bloom. Each stage keeps what the one before had and adds to it.
 */
export function Tree({ stage }: { stage: number }) {
  // The rotation sits on a group: the grow-in animation transforms the leaf itself.
  const leaf = (x: number, y: number, r: number, rot: number, i: number) => (
    <g key={`${x}-${y}`} transform={`rotate(${rot} ${x} ${y})`}>
      <ellipse cx={x} cy={y} rx={r} ry={r / 2.2} className="tree-leaf" style={{ '--i': i } as CSSProperties} />
    </g>
  );
  const crown = (cx: number, cy: number, r: number, i: number) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} className="tree-crown" style={{ '--i': i } as CSSProperties} />;
  const blossom = (cx: number, cy: number, i: number) => <circle key={`b${cx}-${cy}`} cx={cx} cy={cy} r={3.2} className="tree-blossom" style={{ '--i': i } as CSSProperties} />;

  return (
    <svg viewBox="0 0 120 120" className="tree" role="img" aria-label="Your tree">
      <path d="M10 104 Q60 96 110 104" className="tree-soil" />
      {stage === 0 && <ellipse cx="60" cy="101" rx="5" ry="3.5" className="tree-seed" />}
      {stage >= 1 && stage <= 2 && (
        <>
          <path d={stage === 1 ? 'M60 101 Q59 90 60 84' : 'M60 101 Q58 82 61 66'} className="tree-stem" />
          {leaf(stage === 1 ? 54 : 53, stage === 1 ? 84 : 72, 7, -30, 0)}
          {leaf(stage === 1 ? 66 : 68, stage === 1 ? 82 : 68, 7, 25, 1)}
          {stage === 2 && [leaf(52, 86, 6, -35, 2), leaf(67, 84, 6, 30, 3), leaf(61, 62, 6, -80, 4)]}
        </>
      )}
      {stage >= 3 && (
        <>
          <path d={stage === 3 ? 'M57 101 L58 70 Q60 62 62 70 L63 101 Z' : 'M54 101 Q57 82 57 60 L63 60 Q63 82 66 101 Z'} className="tree-trunk" />
          {stage >= 4 && <path d="M58 66 Q50 58 44 52 M62 64 Q70 56 76 50 M60 60 L60 40" className="tree-branch" />}
          {stage === 3 && [crown(60, 54, 16, 0), crown(48, 62, 10, 1), crown(72, 61, 10, 2)]}
          {stage >= 4 && [crown(60, 38, 20, 0), crown(40, 52, 15, 1), crown(80, 50, 15, 2), crown(52, 30, 12, 3), crown(70, 28, 12, 4)]}
          {stage >= 5 &&
            [
              [48, 32],
              [62, 24],
              [74, 34],
              [38, 50],
              [56, 44],
              [82, 50],
              [66, 52],
              [46, 58],
              [76, 26],
              [52, 22],
              [86, 42],
              [34, 44],
            ].map(([x, y], i) => blossom(x, y, i))}
          {stage >= 5 && <path d="M30 92 q2 -3 4 0 M88 96 q2 -3 4 0 M74 88 q2 -3 4 0" className="tree-petal" />}
        </>
      )}
    </svg>
  );
}
