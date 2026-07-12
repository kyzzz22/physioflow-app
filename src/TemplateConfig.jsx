import { useState } from 'react';

export default function TemplateButton({ label, onCreate, templateKey }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(templateKey === 'stroop'
    ? { trials: 16, practice: true, jitter: 300 }
    : { trials: 40, goRatio: 70, practice: true, jitter: 250 }
  );

  const handleCreate = () => { setOpen(false); onCreate(cfg); };

  return <span style={{ position: 'relative', display: 'inline-block' }}>
    <button onClick={() => setOpen(o => !o)}>{label}{open ? ' ▾' : ' ▸'}</button>
    {open && <>
      <div style={{ position:'fixed',inset:0,zIndex:80 }} onClick={() => setOpen(false)} />
      <div style={{ position:'absolute',top:'100%',left:0,marginTop:4,zIndex:81,background:'var(--paper)',border:'1px solid var(--line)',borderRadius:8,padding:'.8rem',minWidth:220,boxShadow:'var(--shadow-md)',fontSize:'.78rem' }}>
        {templateKey === 'stroop' ? <>
          <label style={{ display:'grid',gap:'.2rem',marginBottom:'.5rem' }}>
            Trials <input type="number" min={4} max={64} step={4} value={cfg.trials} onChange={e => setCfg(p => ({...p,trials:Number(e.target.value)}))} style={{ width:'100%',padding:'.3rem',border:'1px solid var(--line)',borderRadius:4 }} />
            <small style={{color:'var(--muted)'}}>4 colors × (trials/4) words each</small>
          </label>
        </> : <>
          <label style={{ display:'grid',gap:'.2rem',marginBottom:'.5rem' }}>
            Trials <input type="number" min={10} max={100} step={10} value={cfg.trials} onChange={e => setCfg(p => ({...p,trials:Number(e.target.value)}))} style={{ width:'100%',padding:'.3rem',border:'1px solid var(--line)',borderRadius:4 }} />
          </label>
          <label style={{ display:'grid',gap:'.2rem',marginBottom:'.5rem' }}>
            Go ratio: {cfg.goRatio}%
            <input type="range" min={50} max={90} step={5} value={cfg.goRatio} onChange={e => setCfg(p => ({...p,goRatio:Number(e.target.value)}))} />
          </label>
        </>}
        <label style={{ display:'flex',alignItems:'center',gap:'.3rem',marginBottom:'.5rem',fontSize:'.75rem' }}>
          <input type="checkbox" checked={cfg.practice} onChange={e => setCfg(p => ({...p,practice:e.target.checked}))} /> Practice block
        </label>
        <label style={{ display:'grid',gap:'.2rem',marginBottom:'.5rem' }}>
          ITI jitter: {cfg.jitter}ms
          <input type="range" min={0} max={1000} step={50} value={cfg.jitter} onChange={e => setCfg(p => ({...p,jitter:Number(e.target.value)}))} />
        </label>
        <div style={{ display:'flex',gap:'.4rem',marginTop:'.6rem' }}>
          <button className="primary" onClick={handleCreate} style={{flex:1}}>Create</button>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </div>
    </>}
  </span>;
}
