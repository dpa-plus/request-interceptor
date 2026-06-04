import { useMemo, useState } from 'react';

export interface SeriesDef {
  label: string;
  color: string;
  values: number[];      // must align with `labels`
  format?: (v: number) => string;
}

interface LineChartProps {
  labels: string[];      // x-axis tick labels (one per data point)
  series: SeriesDef[];
  height?: number;
  width?: number;        // defaults to 100% of container
}

const PAD = { top: 16, right: 12, bottom: 24, left: 44 };

/**
 * Native SVG line chart — keeps the dashboard dependency-light. Renders one
 * polyline per series with a shared X axis (bucket labels) and an
 * auto-scaled Y axis. Hovering shows a vertical cursor + per-series value
 * read-out.
 */
export function LineChart({ labels, series, height = 180 }: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { yMax, points } = useMemo(() => {
    let max = 0;
    for (const s of series) for (const v of s.values) if (v > max) max = v;
    if (max === 0) max = 1;
    return {
      yMax: max,
      points: series.map((s) => s.values),
    };
  }, [series]);

  if (labels.length === 0) {
    return (
      <div className="h-44 flex items-center justify-center text-xs text-gray-500">
        No data in range.
      </div>
    );
  }

  const W = 600;
  const H = height;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xFor = (i: number) =>
    PAD.left + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const yFor = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  // Build the polyline path for each series
  const paths = points.map((vals) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(v).toFixed(1)}`).join(' ')
  );

  // Reasonable number of x-tick labels (every nth)
  const tickStride = Math.max(1, Math.ceil(labels.length / 8));

  // Format yMax tick label compactly
  const formatY = series[0]?.format ?? ((v: number) => v.toLocaleString());

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const svg = e.currentTarget;
          const rect = svg.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          const innerX = Math.max(0, Math.min(innerW, x - PAD.left));
          const idx = Math.round((innerX / innerW) * (labels.length - 1));
          setHoverIdx(idx);
        }}
      >
        {/* Y gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PAD.top + innerH - f * innerH;
          return (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#21262d" strokeWidth="1" />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" className="fill-gray-600" fontSize="9">
                {formatY(yMax * f)}
              </text>
            </g>
          );
        })}

        {/* X tick labels */}
        {labels.map((l, i) =>
          i % tickStride === 0 ? (
            <text key={i} x={xFor(i)} y={H - 6} textAnchor="middle" className="fill-gray-600" fontSize="9">
              {l}
            </text>
          ) : null
        )}

        {/* Series */}
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={series[i].color} strokeWidth="1.5" />
        ))}

        {/* Hover cursor */}
        {hoverIdx !== null && hoverIdx >= 0 && hoverIdx < labels.length && (
          <>
            <line
              x1={xFor(hoverIdx)} x2={xFor(hoverIdx)}
              y1={PAD.top} y2={PAD.top + innerH}
              stroke="#58a6ff" strokeWidth="1" strokeDasharray="2,2"
            />
            {series.map((s, i) => (
              <circle
                key={i}
                cx={xFor(hoverIdx)} cy={yFor(s.values[hoverIdx] ?? 0)}
                r="3"
                fill={s.color}
              />
            ))}
          </>
        )}
      </svg>

      {/* Hover tooltip + legend */}
      <div className="mt-1 flex items-center justify-between text-xs">
        <div className="flex gap-3">
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1 text-gray-400">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
        {hoverIdx !== null && hoverIdx >= 0 && hoverIdx < labels.length && (
          <div className="text-gray-400 font-mono">
            <span className="text-gray-500">{labels[hoverIdx]}: </span>
            {series.map((s, i) => (
              <span key={s.label} className="ml-2" style={{ color: s.color }}>
                {(s.format ?? ((v: number) => v.toLocaleString()))(s.values[hoverIdx] ?? 0)}
                {i < series.length - 1 ? '' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
