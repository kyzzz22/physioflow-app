import { useMemo } from 'react';
import RuntimeContent from './RuntimeContent';

const TYPE_LABELS = {
  instruction: ['Aa', 'Instruction'],
  fixation: ['＋', 'Fixation'],
  timer: ['◷', 'Timer'],
  rest: ['☕', 'Rest'],
  video: ['▶', 'Video'],
  audio: ['♫', 'Audio'],
  image: ['▧', 'Image'],
  questionnaire: ['☷', 'Questionnaire'],
  response: ['↵', 'Response'],
  manual_event: ['◆', 'Manual event'],
  device_check: ['✓', 'Device check'],
};

export default function StepPreview({ step, trialLayout = {}, stimuli = [], questionnaires = [], language = 'en' }) {
  const resource = useMemo(() => stimuli.find(s => s.stimulus_id === step.stimulus_id), [stimuli, step.stimulus_id]);
  const sharedQ = useMemo(() => questionnaires.find(q => q.questionnaire_id === step.questionnaire_id), [questionnaires, step.questionnaire_id]);

  const resolvedStep = useMemo(() => ({
    ...step,
    name: step.name_i18n?.[language] || step.name,
    questionnaire: step.questionnaire || sharedQ,
    source_mode: (step.source_url || step.asset_id) ? step.source_mode : resource?.source_mode || step.source_mode,
    source_url: step.source_url || resource?.source_url || '',
    asset_id: step.asset_id || resource?.asset_id || '',
    file_name: step.file_name || resource?.file_name || '',
  }), [step, language, resource, sharedQ]);

  const app = (step.appearance && typeof step.appearance === 'object') ? step.appearance : {};
  const eff = {
    background: app.background ?? trialLayout.background ?? '#fffef9',
    color: app.color ?? trialLayout.foreground ?? '#17221d',
    alignment: app.alignment ?? trialLayout.alignment ?? 'center',
    fontSize: app.font_size ?? null,
  };

  const [icon, label] = TYPE_LABELS[step.type] || ['?', step.type];
  const durationLabel = step.planned_duration_ms ? `${Math.round(step.planned_duration_ms / 1000)}s` : '';

  // ── Questionnaire ──
  if (step.type === 'questionnaire') {
    const q = resolvedStep.questionnaire;
    const count = q?.questions?.length || 0;
    const external = (resolvedStep.questionnaire_mode || 'internal') === 'external';
    return (
      <div className="step-preview-card" style={{ background: eff.background, color: eff.color, textAlign: eff.alignment }}>
        <span className="step-preview-badge">{icon} {label}</span>
        <p style={{ fontSize: '.78rem', fontFamily: "'Instrument Serif', serif", margin: '.2rem 0' }}>{external ? 'External form link' : q?.name || 'Untitled questionnaire'}</p>
        <small style={{ color: 'var(--muted)' }}>{external ? (resolvedStep.external_form_url ? 'URL configured' : 'Missing URL') : `${count} question${count !== 1 ? 's' : ''}`}</small>
      </div>
    );
  }

  // ── Instruction / response / manual_event / device_check: text snippet ──
  if (['instruction', 'response', 'manual_event', 'device_check'].includes(step.type)) {
    const text = step.content_i18n?.[language] || step.content || '';
    const snippet = text.length > 80 ? text.slice(0, 80) + '…' : text;
    return (
      <div className="step-preview-card" style={{ background: eff.background, color: eff.color, textAlign: eff.alignment }}>
        <span className="step-preview-badge">{icon} {label}</span>
        {snippet
          ? <p style={{ fontSize: '.78rem', lineHeight: 1.4, margin: '.3rem 0', opacity: .85 }}>{snippet}</p>
          : <p style={{ fontSize: '.74rem', fontStyle: 'italic', opacity: .45, margin: '.3rem 0' }}>Empty — add content below</p>
        }
        {step.type === 'response' && <small style={{ color: 'var(--muted)' }}>{(step.response_options || []).length} option{(step.response_options || []).length !== 1 ? 's' : ''} · variable {step.response_variable || 'response'}</small>}
      </div>
    );
  }

  // ── Fixation: large centered cross ──
  if (step.type === 'fixation') {
    return (
      <div className="step-preview-card" style={{ background: eff.background, color: eff.color, textAlign: 'center', minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.5rem' }}>
        <span className="step-preview-badge">{icon} {label}{durationLabel ? ` · ${durationLabel}` : ''}</span>
        <div style={{ position: 'relative', width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: .6 }}>
          <span style={{ position: 'absolute', width: '100%', height: 2, background: eff.color, borderRadius: 1 }} />
          <span style={{ position: 'absolute', width: 2, height: '100%', background: eff.color, borderRadius: 1 }} />
        </div>
        <small style={{ color: 'var(--muted)', fontSize: '.7rem' }}>Participant fixates on center cross</small>
      </div>
    );
  }

  // ── Timer: full size countdown preview ──
  if (step.type === 'timer') {
    const svgSize = 100, r = 42, c = 2 * Math.PI * r;
    return (
      <div className="step-preview-card" style={{ background: eff.background, color: eff.color, textAlign: 'center', minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.4rem' }}>
        <span className="step-preview-badge">{icon} {label}{durationLabel ? ` · ${durationLabel}` : ''}</span>
        <div style={{ position: 'relative', width: svgSize, height: svgSize }}>
          <svg viewBox={`0 0 ${svgSize} ${svgSize}`} style={{ width: svgSize, height: svgSize, rotate: '-90deg' }}>
            <circle cx={svgSize / 2} cy={svgSize / 2} r={r} fill="none" stroke="#e5ebe4" strokeWidth="4" />
            <circle cx={svgSize / 2} cy={svgSize / 2} r={r} fill="none" stroke="var(--green)" strokeWidth="4" strokeDasharray={c} strokeDashoffset={c * 0.7} strokeLinecap="round" />
          </svg>
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem', fontWeight: 700 }}>{step.planned_duration_ms ? Math.round(step.planned_duration_ms / 1000) : '?'}</span>
        </div>
        <small style={{ color: 'var(--muted)', fontSize: '.7rem' }}>Countdown with visual progress ring</small>
      </div>
    );
  }

  // ── Rest: recovery / break indicator ──
  if (step.type === 'rest') {
    return (
      <div className="step-preview-card" style={{ background: eff.background, color: eff.color, textAlign: 'center', minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.5rem' }}>
        <span className="step-preview-badge">{icon} {label}{durationLabel ? ` · ${durationLabel}` : ''}</span>
        <div style={{ fontSize: '2.8rem', opacity: .5, lineHeight: 1 }}>☕</div>
        <small style={{ color: 'var(--muted)', fontSize: '.7rem' }}>Recovery break before next stimulus</small>
      </div>
    );
  }

  // ── Media types: show compact media player ──
  if (['video', 'audio', 'image'].includes(step.type)) {
    return (
      <div className="step-preview-card" style={{ background: eff.background, color: eff.color, textAlign: eff.alignment, minHeight: 150, maxHeight: 220, overflow: 'hidden', borderRadius: 6, border: '1px solid var(--line)', position: 'relative' }}>
        <span className="step-preview-badge" style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>{icon} {label}</span>
        <div style={{ transform: 'scale(0.55)', transformOrigin: 'center center', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', userSelect: 'none' }}>
          <RuntimeContent step={resolvedStep} language={language} timing={{ current: { remaining: resolvedStep.planned_duration_ms || 0, active: false } }} onComplete={() => {}} onQuestionnaireSubmit={() => {}} onMediaEvent={() => {}} preview fontSize={eff.fontSize} />
        </div>
      </div>
    );
  }

  // ── Fallback ──
  return (
    <div className="step-preview-card" style={{ background: eff.background, color: eff.color, textAlign: eff.alignment }}>
      <span className="step-preview-badge">{icon} {label}</span>
    </div>
  );
}
