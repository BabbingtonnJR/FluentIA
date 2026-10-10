import { useState } from 'react';

export interface Series {
  name: string;
  color: string; // CSS color, usually a var(--series-*) token
}

export interface BarDatum {
  label: string; // day key YYYY-MM-DD
  values: number[]; // one per series, stacked bottom → top
}

const W = 320;
const PAD_L = 26;
const PAD_B = 18;
const GAP = 2;

function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 2.5, 5, 10].find((s) => s * pow >= n)! * pow;
}

function shortDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Rectangle with only the top corners rounded, so bars sit flat on the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * Small stacked bar chart for daily counts. Tap or hover a day to read its values;
 * the same numbers are available as a table for screen readers.
 */
export function BarChart({
  data,
  series,
  height = 140,
  title,
  defaultIndex,
}: {
  data: BarDatum[];
  series: Series[];
  height?: number;
  title: string;
  /** Bar whose values are shown before the user picks one (default: the last). */
  defaultIndex?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotH = height - PAD_B - 6;
  const slot = (W - PAD_L) / data.length;
  const barW = Math.max(3, slot - Math.max(2, slot * 0.28));
  const y = (v: number) => 6 + plotH - (v / max) * plotH;
  const shown = active ?? defaultIndex ?? data.length - 1;
  const d = data[shown];
  const labelIdx = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  return (
    <figure style={{ margin: 0 }}>
      {series.length > 1 && (
        <div className="legend" style={{ marginBottom: 6 }}>
          {series.map((s) => (
            <span key={s.name} style={{ ['--c' as string]: s.color }}>
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="chart-readout" aria-live="polite">
        {d && (
          <>
            <strong>{shortDay(d.label)}</strong>
            {series.map((s, i) => ` · ${d.values[i]} ${s.name.toLowerCase()}`).join('')}
          </>
        )}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} onMouseLeave={() => setActive(null)}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={v === 0 ? 1 : 0.5} />
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {data.map((datum, i) => {
          const x = PAD_L + i * slot + (slot - barW) / 2;
          let base = 0;
          const top = datum.values.reduce((last, v, s) => (v > 0 ? s : last), -1);
          return (
            <g key={datum.label}>
              {datum.values.map((v, s) => {
                if (v <= 0) return null;
                const y0 = y(base);
                const y1 = y(base + v);
                base += v;
                // 2px surface gap between stacked segments
                const h = Math.max(1, y0 - y1 - (s === top ? 0 : GAP));
                return s === top ? (
                  <path key={s} d={topRounded(x, y1, barW, y0 - y1, 4)} fill={series[s].color} />
                ) : (
                  <rect key={s} x={x} y={y0 - h} width={barW} height={h} fill={series[s].color} />
                );
              })}
              <rect
                className={`hit${shown === i && active !== null ? ' active' : ''}`}
                x={PAD_L + i * slot}
                y={0}
                width={slot}
                height={height - PAD_B}
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(i)}
              />
            </g>
          );
        })}
        {labelIdx.map((i) => (
          <text key={i} x={PAD_L + i * slot + slot / 2} y={height - 4} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
            {shortDay(data[i].label)}
          </text>
        ))}
      </svg>
      <details>
        <summary>Show data</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th>Day</th>
              {series.map((s) => (
                <th key={s.name}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.label}>
                <td>{shortDay(row.label)}</td>
                {row.values.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
