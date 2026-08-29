import { useMemo, useState } from 'react';
import { affectPoints, affectQuadrant, seriesColor } from './chartGeometry.js';

// Affect map (D8): the valence/arousal circumplex.
//
// Responses are plotted on the standard two-dimensional affect grid with the
// quadrants named (excited / calm / stressed / sad). A trajectory line connects
// the points in the order they were recorded, which makes drift through a
// session visible — a static scatter hides it.

const QUADRANT_LABELS = {
  excited: 'excited / tense',
  calm: 'calm / content',
  stressed: 'stressed / anxious',
  sad: 'sad / depressed',
};

export default function AffectMap({
  responses = [],
  scale = 'sam',
  width = 420,
  height = 420,
  padding = 44,
  showTrajectory = true,
  onSelect = null,
}) {
  const [selected, setSelected] = useState(null);
  const points = useMemo(() => affectPoints(responses, { scale }), [responses, scale]);

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const toX = v => padding + ((v + 1) / 2) * innerW;
  const toY = a => padding + ((1 - a) / 2) * innerH;

  if (!points.length) {
    return <div className="viz-empty">No valence/arousal responses to plot.</div>;
  }

  const active = selected !== null ? points[selected] : null;
  const counts = points.reduce((acc, p) => {
    const q = affectQuadrant(p);
    acc[q] = (acc[q] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="viz-affect">
      <svg viewBox={`0 0 ${width} ${height}`} className="viz-svg" role="img" aria-label="Valence-arousal affect map">
        <rect x={padding} y={padding} width={innerW} height={innerH} className="viz-plot-bg" />

        {/* Quadrant shading + labels */}
        <rect x={toX(0)} y={padding} width={innerW / 2} height={innerH / 2} className="viz-quadrant" />
        <rect x={padding} y={toY(0)} width={innerW / 2} height={innerH / 2} className="viz-quadrant" />
        <text x={toX(0.6)} y={toY(0.9)} className="viz-quadrant-label">excited</text>
        <text x={toX(-0.6)} y={toY(0.9)} className="viz-quadrant-label">stressed</text>
        <text x={toX(0.6)} y={toY(-0.9)} className="viz-quadrant-label">calm</text>
        <text x={toX(-0.6)} y={toY(-0.9)} className="viz-quadrant-label">sad</text>

        {/* Axes through the neutral centre */}
        <line x1={toX(0)} y1={padding} x2={toX(0)} y2={height - padding} className="viz-axis" />
        <line x1={padding} y1={toY(0)} x2={width - padding} y2={toY(0)} className="viz-axis" />

        <text x={width / 2} y={height - 8} textAnchor="middle" className="viz-axis-text">valence →</text>
        <text x={12} y={height / 2} textAnchor="middle" className="viz-axis-text" transform={`rotate(-90 12 ${height / 2})`}>arousal →</text>

        {showTrajectory && points.length > 1 && (
          <polyline
            className="viz-trajectory"
            fill="none"
            points={points.map(p => `${toX(p.valence).toFixed(1)},${toY(p.arousal).toFixed(1)}`).join(' ')}
          />
        )}

        {points.map((p, i) => (
          <circle
            key={p.label || i}
            cx={toX(p.valence)}
            cy={toY(p.arousal)}
            r={selected === i ? 8 : 5}
            fill={seriesColor(i % 8)}
            className="viz-affect-point"
            onClick={() => { setSelected(i); onSelect?.(p, i); }}
          >
            <title>{`${p.label || `#${i + 1}`}: valence ${p.valence.toFixed(2)}, arousal ${p.arousal.toFixed(2)}`}</title>
          </circle>
        ))}
      </svg>

      <div className="viz-affect-foot">
        {Object.entries(QUADRANT_LABELS).map(([key, label]) => (
          <span key={key}>
            <b>{counts[key] || 0}</b> {label}
          </span>
        ))}
      </div>

      {active && (
        <div className="viz-readout">
          <span className="viz-readout-item">
            {active.label || '#1'}: valence {active.valence.toFixed(2)}, arousal {active.arousal.toFixed(2)}
            {' · '}{QUADRANT_LABELS[affectQuadrant(active)]}
          </span>
        </div>
      )}
    </div>
  );
}
