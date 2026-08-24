import { useMemo, useState } from 'react';
import { calibrationReport, getViewportDimensions, visualAngleToPixels } from './visualAngle.js';

const MSG = { en: 'Screen calibration', zh: '屏幕校准', ja: '画面校正' };
const CONFIRM = { en: 'Confirm calibration', zh: '确认校准', ja: '校正を確認' };

// True screen-calibration runner: renders a reference stimulus at a known visual
// angle (computed from viewing distance + physical screen size + real viewport
// pixels), reports the resulting pixels-per-degree, and records the report.
export default function CalibrationRunner({ config, language = 'en', disabled = false, onSubmit }) {
  const [phase, setPhase] = useState('ready');
  const viewport = useMemo(() => {
    try {
      return getViewportDimensions();
    } catch {
      return { widthPx: 1280, heightPx: 800, devicePixelRatio: 1 };
    }
  }, []);
  const report = useMemo(() => calibrationReport({
    displayWidthPx: viewport.widthPx,
    displayHeightPx: viewport.heightPx,
    displayWidthCm: Number(config?.screenWidthCm || 60),
    displayHeightCm: Number(config?.screenHeightCm || 34),
    viewingDistanceCm: Number(config?.viewingDistanceCm || 60),
  }), [viewport.widthPx, viewport.heightPx, config?.screenWidthCm, config?.screenHeightCm, config?.viewingDistanceCm]);
  const referenceDeg = 2;
  const referencePx = report.pixels_per_degree ? visualAngleToPixels(referenceDeg, report.pixels_per_degree) : 40;
  const msg = value => value?.[language] || value?.en || value?.zh || '';

  if (phase === 'done') {
    return <div className="calibration done"><h1>✓</h1><p>{report.pixels_per_degree} px/°</p></div>;
  }

  const payload = {
    pixels_per_degree: report.pixels_per_degree,
    pixels_per_cm: report.pixels_per_cm,
    viewing_distance_cm: report.viewing_distance_cm,
    screen_width_cm: report.screen_width_cm,
    screen_height_cm: report.screen_height_cm,
    one_degree_px: report.references?.one_degree_px,
    two_degrees_px: report.references?.two_degrees_px,
    five_degrees_px: report.references?.five_degrees_px,
    ten_degrees_px: report.references?.ten_degrees_px,
    reference_degrees: referenceDeg,
    reference_px: referencePx,
    calibration_confirmed: true,
  };

  return <div className="calibration" role="region" aria-label={msg(MSG)}>
    <span className="eyebrow">{msg(MSG)}</span>
    <p>{report.viewing_distance_cm} cm · {report.screen_width_cm} × {report.screen_height_cm} cm · {viewport.widthPx}×{viewport.heightPx} px</p>
    <div className="calibration-stage">
      <div className="calibration-reference" style={{ width: referencePx, height: referencePx }} />
      <p>The square spans {referenceDeg}° of visual angle.</p>
    </div>
    <p><b>{report.pixels_per_degree}</b> pixels per degree · 1° = {report.references?.one_degree_px} px · 5° = {report.references?.five_degrees_px} px</p>
    <button type="button" className="participant-ui-button primary" disabled={disabled} onClick={() => {
      setPhase('done');
      onSubmit?.({ values: payload, outputs: payload, variables: { pixels_per_degree: report.pixels_per_degree, calibration_reference_px: referencePx } });
    }}>{msg(CONFIRM)}</button>
  </div>;
}
