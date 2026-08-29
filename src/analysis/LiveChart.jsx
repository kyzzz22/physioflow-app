import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createScales,
  decimateMinMax,
  formatAxisTime,
  padExtent,
  combinedExtent,
  seriesColor,
  seriesPath,
} from './chartGeometry.js';

// Realtime (streaming) multi-channel chart (D8).
//
// Shows a sliding window of the most recent samples. The data source is injected
// by the caller (`sampleSource`) because PF does not stream from the device
// runtime into this panel yet (that is D9); when no source is supplied the
// component still renders whatever `samples` it is given, which keeps it usable
// for replaying a recorded session.
//
// Rendering is driven by requestAnimationFrame rather than by every incoming
// sample: at 256 Hz a naive per-sample render would starve the main thread.

const DEFAULT_PADDING = { top: 10, right: 12, bottom: 20, left: 48 };

export default function LiveChart({
  channels = [],
  samples = {},          // { channelId: values[] }
  times = [],
  windowSeconds = 10,
  sampleRateHz = 50,
  width = 720,
  height = 200,
  padding = DEFAULT_PADDING,
  running = true,
  sampleSource = null,   // optional () => { channelId: value } pulled each frame
  onSample = null,
}) {
  const [buffer, setBuffer] = useState(() => ({ times: [], values: Object.fromEntries(channels.map(id => [id, []])) }));
  const [paused, setPaused] = useState(!running);
  const frameRef = useRef(0);
  const maxPoints = Math.max(2, Math.round(windowSeconds * sampleRateHz));

  // Seed or replace the buffer whenever the caller supplies a full record.
  useEffect(() => {
    if (!times.length) return;
    setBuffer({ times: [...times], values: Object.fromEntries(channels.map(id => [id, [...(samples[id] || [])]])) });
  }, [times, samples, channels]);

  useEffect(() => {
    if (!sampleSource || paused) return undefined;
    let raf = 0;
    const tick = () => {
      const next = sampleSource();
      if (next) {
        setBuffer((prev) => {
          const at = new Date().toISOString();
          const values = { ...prev.values };
          for (const id of channels) {
            const list = values[id] ? [...values[id]] : [];
            list.push(next[id] ?? null);
            // Trim to the window so memory stays flat over a long run.
            values[id] = list.length > maxPoints ? list.slice(list.length - maxPoints) : list;
          }
          const times2 = [...prev.times, at];
          return {
            times: times2.length > maxPoints ? times2.slice(times2.length - maxPoints) : times2,
            values,
          };
        });
        onSample?.(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    frameRef.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [sampleSource, paused, channels, maxPoints, onSample]);

  const view = useMemo(() => {
    const active = channels.filter(id => buffer.values[id]?.length);
    if (!active.length) return null;
    const extent = padExtent(combinedExtent(active.map(id => buffer.values[id])));
    if (extent.min === null) return null;
    const count = Math.max(2, Math.max(...active.map(id => buffer.values[id].length)));
    const scales = createScales({ count, min: extent.min, max: extent.max, width, height, padding });
    const budget = Math.max(2, Math.floor((width - padding.left - padding.right) * 2));
    return {
      extent,
      scales,
      traces: active.map(id => ({
        id,
        path: seriesPath(decimateMinMax(buffer.values[id], budget), scales),
      })),
    };
  }, [buffer, channels, width, height, padding]);

  const latest = channels.map(id => {
    const list = buffer.values[id];
    return list && list.length ? list[list.length - 1] : null;
  });

  return (
    <div className="viz-live">
      <div className="viz-live-head">
        <span className="viz-live-title">Realtime · {windowSeconds}s window</span>
        {sampleSource && (
          <button type="button" className="bio-btn" onClick={() => setPaused(p => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="viz-svg" role="img" aria-label="Realtime signal">
        <rect x={padding.left} y={padding.top} width={view?.scales.innerW ?? 0} height={view?.scales.innerH ?? 0} className="viz-plot-bg" />
        {view && view.traces.map((trace, i) => (
          <path key={trace.id} d={trace.path} fill="none" stroke={seriesColor(i)} strokeWidth="1.5" className="viz-line" />
        ))}
      </svg>

      <div className="viz-readout">
        {channels.map((id, i) => (
          <span key={id} className="viz-readout-item">
            <i style={{ background: seriesColor(i) }} />
            {id}: {Number.isFinite(latest[i]) ? latest[i].toFixed(3) : '—'}
          </span>
        ))}
        {buffer.times.length > 0 && <span className="viz-readout-time">{formatAxisTime(buffer.times[buffer.times.length - 1])}</span>}
      </div>
    </div>
  );
}
