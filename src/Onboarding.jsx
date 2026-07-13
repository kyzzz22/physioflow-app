import { useEffect, useState } from 'react';

const STEPS = [
  {
    target: '.dashboard-actions',
    title: 'Welcome to PhysioFlow',
    body: 'Start here — create a new experiment protocol, or choose a template to get going quickly.',
    position: 'right',
  },
  {
    target: '.dashboard-workflow',
    title: 'Four-step workflow',
    body: 'Build your protocol, validate it, run a session, then review and export your data.',
    position: 'bottom',
  },
  {
    target: '.storage-banner',
    title: 'Local data folder',
    body: 'Choose a folder on your computer. All protocols, sessions, and media stay there — not in browser cache.',
    position: 'bottom',
  },
  {
    target: '.protocol-grid',
    title: 'Your projects',
    body: 'Each project stores its protocol versions here. Open, edit, or freeze them for formal data collection.',
    position: 'top',
  },
  {
    target: '.header-tools',
    title: 'Language & theme',
    body: 'Switch between English, 中文, 日本語 and toggle dark mode anytime.',
    position: 'bottom',
  },
];

export default function Onboarding({ onClose }) {
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    const updatePos = () => {
      const el = document.querySelector(current.target);
      if (!el) { setPos({ top: 120, left: '50%', transform: 'translateX(-50%)' }); return; }
      const rect = el.getBoundingClientRect();
      const positions = {
        right:  { top: rect.top + rect.height / 2, left: rect.right + 16 },
        bottom: { top: rect.bottom + 12, left: rect.left + rect.width / 2 },
        top:    { top: rect.top - 12, left: rect.left + rect.width / 2 },
        left:   { top: rect.top + rect.height / 2, left: rect.left - 16 },
      };
      const p = positions[current.position] || positions.right;
      const isSide = current.position === 'right' || current.position === 'left';
      setPos({ ...p, isSide });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, [step, current.target, current.position]);

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft' && step > 0) setStep(s => s - 1); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step, onClose]);

  const next = () => { if (isLast) onClose(); else setStep(s => s + 1); };

  return <>
    <div style={{ position:'fixed',inset:0,background:'#00000050',zIndex:9999 }} onClick={onClose} />
    <div style={{
      position:'fixed',zIndex:10000,background:'var(--paper)',border:'1px solid var(--line)',borderRadius:10,
      boxShadow:'0 16px 48px #00000030',padding:'1.2rem 1.5rem',minWidth:300,maxWidth:380,
      ...(pos.isSide ? { top: pos.top, transform: 'translateY(-50%)' } : { left: pos.left, transform: 'translateX(-50%)' }),
      ...(pos.isSide ? { left: pos.left } : { top: pos.top }),
      fontFamily:'system-ui,sans-serif'
    }}>
      <div style={{ display:'flex',alignItems:'center',gap:'.5rem',marginBottom:'.5rem' }}>
        <span style={{ display:'grid',placeItems:'center',width:28,height:28,borderRadius:8,background:'var(--lime)',color:'#263a12',fontWeight:800,fontSize:'.8rem' }}>{step + 1}/{STEPS.length}</span>
        <b style={{ fontSize:'.95rem' }}>{current.title}</b>
      </div>
      <p style={{ color:'var(--muted)',fontSize:'.82rem',lineHeight:1.55,margin:'0 0 1rem' }}>{current.body}</p>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center' }}>
        <button onClick={onClose} style={{ fontSize:'.75rem',border:'0',background:'transparent',color:'var(--muted)',cursor:'pointer' }}>Skip tour</button>
        <div style={{ display:'flex',gap:'.4rem',alignItems:'center' }}>
          {STEPS.map((_, i) => <span key={i} style={{ width:6,height:6,borderRadius:'50%',background:i===step?'var(--green)':'var(--line)' }} />)}
          {step > 0 && <button onClick={() => setStep(s => s - 1)} style={{ fontSize:'.75rem',padding:'.3rem .6rem' }}>← Back</button>}
          <button className="primary" onClick={next} style={{ fontSize:'.75rem',padding:'.3rem .8rem' }}>{isLast ? '✓ 开始使用' : 'Next →'}</button>
        </div>
      </div>
    </div>
  </>;
}
