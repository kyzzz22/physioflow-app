import { useMemo, useRef, useState } from 'react';
import {
  areaPath,
  combinedExtent,
  createScales,
  decimateMinMax,
  eventMarkers,
  formatAxisTime,
  niceTicks,
  padExtent,
  seriesColor,
  seriesPath,
  timeTicks,
} from './chartGeometry.js';

// Historical multi-channel time-series chart (D8).
//
// Renders any number of channels as overlaid SVG traces with shared time axis,
// event markers, hover readout and drag-to-zoom. Geometry comes from
// chartGeometry.js; this component only draws what it is given.

const DEFAULT_PADDING = { top: 12, right: 16, bottom: 26, left: 52 };

export default function MultiChannelChart({
  times = [],
  series = {},          // { channelId: values[] }
  events = [],
  width = 720,
  height = 260,
  padding = DEFAULT_PADDING,
  units = {},           // { channelId: 'uV' }
  showEvents = true,
  onHover = null,
}) {
  const [zoom, setZoom] = useState(null);   // { startIndex, endIndex } or null
  const [hover, setHover] = useState(null); // sample index under the cursor
  const [dragTo, setDragTo] = useState(null);
  // Drag origin lives in a ref so pointer moves do not re-render the whole chart.
  const dragStart = useRef(null);

  const channels = Object.keys(series).filter(id => Array.isArray(series[id]) && series[id].length);

  const view = useMemo(() => {
    if (!channels.length || !times.length) return null;
    const start = zoom ? Math.max(0, Math.floor(zoom.startIndex)) : 0;
    const end = zoom ? Math.min(times.length - 1, Math.ceil(zoom.endIndex)) : times.length - 1;
    if (end - start < 1) return null;

    const windowTimes = times.slice(start, end + 1);
    // Two passes per pixel: min/max decimation keeps the envelope of every channel.
    const maxPoints = Math.max(2, Math.floor((width - padding.left - padding.right) * 2));
    const traces = channels.map(id => ({
      id,
      unit: units[id] || '',
      points: decimateMinMax(series[id].slice(start, end + 1), maxPoints),
    }));

    const extent = padExtent(combinedExtent(channels.map(id => series[id].slice(start, end + 1))));
    if (extent.min === null) return null;
    const scales = createScales({
      count: Math.max(2, windowTimes.length),
      min: extent.min,
      max: extent.max,
      width,
      height,
      padding,
    });

    return {
      start,
      end,
      windowTimes,
      traces: traces.map(t => ({ ...t, path: seriesPath(t.points, scales) })),
      scales,
      extent,
      markers: showEvents ? eventMarkers(events, windowTimes, scales) : [],
    };
  }, [times, series, channels, zoom, width, height, padding, events, showEvents, units]);

  if (!view) {
    return <div className="viz-empty">No samples to plot.</div>;
  }

  const { scales, extent, traces, markers, windowTimes } = view;
  const yTicks = niceTicks(extent.min, extent.max, 5);
  const xTicks = timeTicks(windowTimes, 5);

  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The viewBox is scaled to the rendered box, so map back through that ratio.
    const ratio = width / rect.width;
    const px = (event.clientX - rect.left) * ratio;
    if (dragStart.current !== null) setDragTo(px);
    const index = Math.round(scales.xInverse(px)) + view.start;
    if (index >= 0 && index < times.length) {
      setHover(index);
      onHover?.(index);
    }
  };

  const handlePointerUp = (event) => {
    if (dragStart.current === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = width / rect.width;
    const px = (event.clientX - rect.left) * ratio;
    const from = scales.xInverse(dragStart.current);
    const to = scales.xInverse(px);
    dragStart.current = null;
    setDragTo(null);
    if (Math.abs(to - from) < 5) return; // a click, not a drag
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    setZoom({
      startIndex: view.start + Math.max(0, a),
      endIndex: view.start + Math.min(windowTimes.length - 1, b),
    });
  };

  return (
    <div className="viz-chart">
      <div className="viz-legend">
        {traces.map((trace, i) => (
          <span key={trace.id} className="viz-legend-item">
            <i style={{ background: seriesColor(i) }} />
            {trace.id}{trace.unit ? ` (${trace.unit})` : ''}
          </span>
        ))}
        {zoom && (
          <button type="button" className="bio-btn viz-zoom-reset" onClick={() => setZoom(null)}>
            Reset zoom
          </button>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="viz-svg"
        role="img"
        aria-label={`Time series for ${channels.join(', ')}`}
        onPointerMove={handlePointerMove}
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          dragStart.current = (e.clientX - rect.left) * (width / rect.width);
          setDragTo(dragStart.current);
        }}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { setHover(null); setDragTo(null); dragStart.current = null; onHover?.(null); }}
      >
        <rect x={padding.left} y={padding.top} width={scales.innerW} height={scales.innerH} className="viz-plot-bg" />

        {yTicks.map(tick => (
          <g key={`y-${tick}`}>
            <line x1={padding.left} y1={scales.y(tick)} x2={width - padding.right} y2={scales.y(tick)} className="viz-grid" />
            <text x={padding.left - 6} y={scales.y(tick) + 4} textAnchor="end" className="viz-axis-text">{formatTick(tick)}</text>
          </g>
        ))}

        {xTicks.map(tick => (
          <text key={`x-${tick.index}`} x={scales.x(tick.index)} y={height - 8} textAnchor="middle" className="viz-axis-text">
            {formatAxisTime(tick.time)}
          </text>
        ))}

        {traces.map((trace, i) => (
          <g key={trace.id}>
            {i === 0 && (
              <path d={areaPath(trace.points, scales, extent.min)} fill={seriesColor(i)} className="viz-area" />
            )}
            <path d={trace.path} fill="none" stroke={seriesColor(i)} strokeWidth="1.5" className="viz-line" />
          </g>
        ))}

        {markers.map(marker => (
          <g key={marker.id} className="viz-marker">
            <line x1={marker.x} y1={padding.top} x2={marker.x} y2={padding.top + scales.innerH} />
            {marker.label && <text x={marker.x + 3} y={padding.top + 10}>{marker.label}</text>}
          </g>
        ))}

        {dragTo !== null && dragStart.current !== null && (
          <rect
            x={Math.min(dragStart.current, dragTo)}
            y={padding.top}
            width={Math.abs(dragTo - dragStart.current)}
            height={scales.innerH}
            className="viz-brush"
          />
        )}

        {hover !== null && hover >= view.start && hover <= view.end && (
          <g className="viz-cursor">
            <line x1={scales.x(hover - view.start)} y1={padding.top} x2={scales.x(hover - view.start)} y2={padding.top + scales.innerH} />
            {traces.map((trace, i) => {
              const raw = series[trace.id]?.[hover];
              if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
              return <circle key={trace.id} cx={scales.x(hover - view.start)} cy={scales.y(raw)} r="3" fill={seriesColor(i)} />;
            })}
          </g>
        )}
      </svg>

      {hover !== null && (
        <div className="viz-readout">
          <span className="viz-readout-time">{formatAxisTime(times[hover], { withDate: true })}</span>
          {channels.map((id, i) => (
            <span key={id} className="viz-readout-item">
              <i style={{ background: seriesColor(i) }} />
              {id}: {Number.isFinite(series[id]?.[hover]) ? formatValue(series[id][hover]) : '—'}
              {units[id] ? ` ${units[id]}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (abs >= 10) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function formatValue(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(4);
}
