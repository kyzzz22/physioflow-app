export default function SamFigure({ type, value, min, max }) {
  const t = (value - min) / Math.max(1, max - min);
  const size = 32;
  if (type === 'sam_valence') {
    const mouthCurve = -12 + t * 24;
    const eyeSize = 2.5 + t * 0.5;
    return <svg width={size} height={size} viewBox="0 0 32 32" className="sam-figure-svg" aria-hidden="true">
      <circle cx={16} cy={16} r={14} fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx={10} cy={11} r={eyeSize} fill="currentColor" />
      <circle cx={22} cy={11} r={eyeSize} fill="currentColor" />
      <path d={`M 8 18 Q 16 ${18 + mouthCurve} 24 18`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>;
  }
  const bodyR = 4 + t * 8;
  const limbSpread = 3 + t * 9;
  return <svg width={size} height={size} viewBox="0 0 32 32" className="sam-figure-svg" aria-hidden="true">
    <ellipse cx={16} cy={16} rx={bodyR} ry={bodyR * 1.3} fill="currentColor" />
    <line x1={16} y1={8} x2={16 - limbSpread} y2={16 - bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1={16} y1={8} x2={16 + limbSpread} y2={16 - bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1={16} y1={24} x2={16 - limbSpread} y2={16 + bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line x1={16} y1={24} x2={16 + limbSpread} y2={16 + bodyR} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
