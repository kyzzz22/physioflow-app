import { useMemo, useRef, useState } from 'react';
import { LanguageToggle, DarkModeToggle } from './i18n';
import { createNextProtocolVersion, duplicateProtocolAsProject, hashProtocol, protocolDiff, validateProtocol } from './domain';
import { verifyProtocolAssets } from './assetStore.js';
import { ConfirmDialog, AlertDialog } from './Modal.jsx';
import { assessProtocolReadiness, summarizeWorkspaceReadiness } from './readiness.js';
import TemplateButton from './TemplateConfig.jsx';
import {
  createNextGraphProtocolVersion,
  duplicateGraphProtocolAsProject,
  hashProtocolGraph,
  isGraphProtocol,
  projectIdOf,
  protocolArchivedAtOf,
  protocolConfigHashOf,
  protocolIdOf,
  protocolNameOf,
  protocolStatusOf,
  protocolVersionLabelOf,
  protocolVersionOf,
  validateProtocolGraph,
} from './core/index.js';
import { createProjectComponentRegistry } from './sdk/index.js';

const groupProjects = protocols => Object.values(protocols
  .filter(item => protocolStatusOf(item) !== 'retired' && !protocolArchivedAtOf(item))
  .reduce((groups, item) => { (groups[projectIdOf(item)] ??= []).push(item); return groups; }, {}))
  .map(versions => versions.sort((left, right) => protocolVersionOf(right) - protocolVersionOf(left)));

function estimateDuration(protocol) {
  if (isGraphProtocol(protocol)) {
    return protocol.graph.nodes.reduce((total, node) => {
      const duration = node.config?.completion?.durationMs ?? node.config?.durationMs ?? 0;
      return total + (Number(duration) || 0);
    }, 0);
  }
  return protocol.blocks.reduce((sum, b) => {
    const br = Math.max(0, Number(b.repeat_count ?? 1));
    return sum + br * b.trials.reduce((ts, t) => {
      const tr = Math.max(0, Number(t.repeat_count ?? 1));
      return ts + tr * t.steps.reduce((ss, s) => ss + (s.duration_mode === 'fixed' ? (Number(s.planned_duration_ms) || 0) : 0), 0);
    }, 0);
  }, 0);
}

function formatDuration(ms) {
  if (!ms) return '';
  const m = Math.round(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return m > 0 ? `~${m}m ${s}s` : `~${s}s`;
}

export default function Dashboard({ protocols, sessions, onOpen, onNew, onTemplate, onImport, onRun, onNextVersion, onDuplicate, onArchive, onRenameProject, onMigrate, onAnalytics, storageInfo, onChooseDataDirectory, onOpenDataFolder, onGuide, onStroopTemplate, onGonogoTemplate }) {
  const input = useRef(null);
  const projects = groupProjects(protocols);
  const workspaceReadiness = useMemo(() => summarizeWorkspaceReadiness(protocols, sessions, storageInfo), [protocols, sessions, storageInfo]);
  const [sessionFilter, setSessionFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const debounceRef = useRef(null);
  const [confirmState, setConfirm] = useState(null);
  const [alertState, setAlert] = useState(null);

  const handleFilterChange = value => {
    setSessionFilter(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedFilter(value), 150);
  };

  const filteredSessions = useMemo(() => {
    const q = debouncedFilter.toLowerCase().trim();
    const all = [...sessions].reverse();
    if (!q) return all;
    return all.filter(s => (s.participant_id || '').toLowerCase().includes(q) || (s.protocol_name || '').toLowerCase().includes(q) || (s.run_mode || '').toLowerCase().includes(q) || String(s.protocol_version || '').includes(q));
  }, [sessions, debouncedFilter]);

  const importFile = async file => {
    try {
      const candidate = JSON.parse(await file.text());
      const graphCandidate = isGraphProtocol(candidate);
      const check = graphCandidate
        ? validateProtocolGraph(candidate, createProjectComponentRegistry(candidate))
        : validateProtocol(candidate);
      if (!check.valid) throw new Error(check.errors.slice(0, 8).map(error => error.message || error).join('\n'));
      if (!graphCandidate && candidate.status === 'frozen') {
        if (!candidate.config_hash) throw new Error('Frozen protocol has no config_hash.');
        const actualHash = await hashProtocol(candidate);
        if (actualHash !== candidate.config_hash) throw new Error(`Frozen protocol hash mismatch.\nExpected ${candidate.config_hash}\nActual ${actualHash}`);
      }
      if (graphCandidate && protocolStatusOf(candidate) === 'frozen') {
        if (!candidate.freeze?.configHash) throw new Error('Frozen Protocol Graph has no config hash.');
        const actualHash = await hashProtocolGraph(candidate);
        if (actualHash !== candidate.freeze.configHash) throw new Error(`Frozen Protocol Graph hash mismatch.\nExpected ${candidate.freeze.configHash}\nActual ${actualHash}`);
      }
      const assets = graphCandidate
        ? { valid: !(candidate.assets || []).some(asset => asset.required && !asset.sourceUrl && !asset.assetId), issues: (candidate.assets || []).filter(asset => asset.required && !asset.sourceUrl && !asset.assetId).map(asset => ({ message: `Missing required asset ${asset.name || asset.id}` })) }
        : await verifyProtocolAssets(candidate);
      let forceDraft = false;
      if (!assets.valid) {
        const proceed = await new Promise(resolve => {
          setConfirm({ title: 'Missing assets', message: `Some uploaded resources are unavailable or changed in this browser:\n\n${assets.issues.map(i => `• ${i.message}`).join('\n')}\n\nImport as an editable draft and reassign those files?`, confirmLabel: 'Import as draft', danger: false, onConfirm: () => { setConfirm(null); resolve(true); }, onCancel: () => { setConfirm(null); resolve(false); } });
        });
        if (!proceed) return;
        forceDraft = true;
      }
      const related = protocols.filter(item => projectIdOf(item) === projectIdOf(candidate)).sort((a, b) => protocolVersionOf(b) - protocolVersionOf(a));
      let imported = structuredClone(candidate);
      if (related.length) {
        const comparison = graphCandidate
          ? { identical: JSON.stringify(related[0].graph) === JSON.stringify(candidate.graph), changes: ['Protocol Graph configuration differs'] }
          : protocolDiff(related[0], candidate);
        const asVersion = await new Promise(resolve => {
          setConfirm({ title: 'Existing project', message: `A project with this project_id already exists.\n\nDifferences from latest version:\n${comparison.identical ? 'No content differences' : comparison.changes.join('\n') || 'Detailed configuration changed'}\n\nOK: import as the next version\nCancel: import as a new project`, confirmLabel: 'Import as version', danger: false, onConfirm: () => { setConfirm(null); resolve(true); }, onCancel: () => { setConfirm(null); resolve(false); } });
        });
        if (asVersion) {
          imported = graphCandidate ? createNextGraphProtocolVersion(candidate) : createNextProtocolVersion(candidate);
          if (graphCandidate) imported.projectId = projectIdOf(related[0]);
          else imported.project_id = projectIdOf(related[0]);
        } else imported = graphCandidate ? duplicateGraphProtocolAsProject(candidate) : duplicateProtocolAsProject(candidate);
      }
      else if (protocols.some(item => protocolIdOf(item) === protocolIdOf(candidate))) imported = graphCandidate ? duplicateGraphProtocolAsProject(candidate) : duplicateProtocolAsProject(candidate);
      if (forceDraft) {
        if (graphCandidate) {
          imported.version = { ...imported.version, status: 'draft' };
          imported.audit = { ...imported.audit, frozenAt: null };
          delete imported.freeze;
        } else {
          imported.status = 'draft'; imported.frozen_at = null; imported.config_hash = null;
        }
      }
      onImport(imported);
    } catch (error) {
      setAlert({ title: 'Import failed', message: error.message });
    }
  };

  return <main>
    <header>
      <div className="brand"><span>PF</span> PhysioFlow</div>
      <div className="header-tools"><div className="local">● Local-first workspace</div><button className="hint" onClick={() => onGuide?.('workflow')}>Help</button><button className="hint" onClick={onChooseDataDirectory}>Data folder</button><DarkModeToggle /><LanguageToggle /></div>
    </header>
    <section className="dashboard-hero">
      <div className="dashboard-copy">
        <span className="eyebrow">EXPERIMENT WORKSPACE</span>
        <h1>PhysioFlow workspace</h1>
        <p>Design protocols, run sessions, review integrity, and export analysis-ready data from one local-first workspace.</p>
        <div className="dashboard-stats" aria-label="Workspace summary">
          <span><b>{projects.length}</b> active projects</span>
          <span><b>{protocols.filter(item => protocolStatusOf(item) === 'frozen').length}</b> frozen versions</span>
          <span><b>{sessions.length}</b> sessions</span>
          <span><b>{workspaceReadiness.ready}</b> ready</span>
        </div>
      </div>
      <div className="dashboard-actions">
        <div className="dashboard-actions-head">
          <b>Start here</b>
          <span>{storageInfo?.selected ? 'Local data folder active' : 'Select a folder before formal collection'}</span>
        </div>
        <button className="primary" onClick={onNew}>＋ New protocol</button>
        <button onClick={onTemplate}>Emotion template</button>
        {onStroopTemplate && <TemplateButton label="Stroop task" onCreate={onStroopTemplate} templateKey="stroop" />}
        {onGonogoTemplate && <TemplateButton label="Go/No-Go task" onCreate={onGonogoTemplate} templateKey="gonogo" />}
        <button onClick={() => input.current.click()}>Import protocol</button>
        <div className="dashboard-secondary-actions">
          <button onClick={() => onGuide?.('workflow')}>Tutorial</button>
          <button onClick={() => onGuide?.('storage')}>Storage</button>
          {onAnalytics && <button onClick={onAnalytics}>Analytics</button>}
        </div>
        <input ref={input} hidden type="file" accept="application/json" onChange={ev => { const file = ev.target.files?.[0]; if (file) importFile(file); ev.target.value = ''; }} />
      </div>
    </section>
    <section className="dashboard-workflow" aria-label="Recommended workflow">
      <article><b>1. Build</b><span>Blocks, trials, nodes, media, and questionnaire content.</span></article>
      <article><b>2. Validate</b><span>Readiness checks, protocol freeze, pilot run, and local storage.</span></article>
      <article><b>3. Run</b><span>Participant setup, sync metadata, recovery, and event logging.</span></article>
      <article><b>4. Review</b><span>Session integrity, responses, analysis windows, and export package.</span></article>
    </section>
    {workspaceReadiness.total > 0 && <section className={`readiness-banner ${workspaceReadiness.blocked ? 'blocked' : workspaceReadiness.attention ? 'attention' : 'ready'}`}>
      <div>
        <b>Lab readiness</b>
        <span>{workspaceReadiness.ready} ready · {workspaceReadiness.attention} need review · {workspaceReadiness.blocked} blocked · average {workspaceReadiness.averageScore}%</span>
      </div>
      <small>{workspaceReadiness.blocked ? 'Fix blocking protocol, media, content, or storage issues before formal collection.' : workspaceReadiness.attention ? 'Review warnings, freeze versions, and run pilot sessions before handoff.' : 'Workspace is ready for collection and export.'}</small>
    </section>}
    <section className={`storage-banner ${storageInfo?.selected ? 'ready' : storageInfo?.supported ? 'setup' : 'blocked'}`}>
      <div>
        <b>{storageInfo?.selected ? `Local folder: ${storageInfo.name}` : storageInfo?.supported ? 'Choose a local data folder' : 'Local folder storage needs Chrome or Edge'}</b>
        <span>{storageInfo?.selected ? 'Protocols, sessions, recovery snapshots, and uploaded media are written to this folder.' : storageInfo?.supported ? 'Required for formal collection: data files stay in a folder you can back up and move.' : 'This browser can only use fallback storage for drafts and previews. Use Chrome, Edge, or the desktop app for formal collection.'}</span>
      </div>
      <div className="storage-actions">
        <button onClick={() => onGuide?.('storage')}>Storage guide</button>
        {storageInfo?.selected && storageInfo?.data_dir && <button onClick={onOpenDataFolder}>Open folder</button>}
        {storageInfo?.supported && <button onClick={onChooseDataDirectory}>{storageInfo?.selected ? 'Change folder' : 'Select folder'}</button>}
      </div>
    </section>
    <section>
      <div className="section-title">
        <h2>Projects</h2>
        <span>{projects.length} active · {protocols.filter(item => protocolStatusOf(item) === 'frozen').length} frozen versions</span>
      </div>
      <div className="protocol-grid">
        {projects.map(versions => <ProjectCard key={projectIdOf(versions[0])} versions={versions} sessions={sessions} storageInfo={storageInfo} onOpen={onOpen} onRun={onRun} onNextVersion={onNextVersion} onDuplicate={onDuplicate} onArchive={onArchive} onRenameProject={onRenameProject} onMigrate={onMigrate} />)}
        {!projects.length && <div className="empty">
          <div className="empty-icon">🧪</div>
          <h3 className="empty-title">No projects yet</h3>
          <p>Create a blank workflow or start from the emotion experiment template.</p>
          <div className="empty-actions">
            <button className="primary" onClick={onNew}>＋ New protocol</button>
            <button onClick={onTemplate}>Emotion template</button>
            {onStroopTemplate && <button onClick={onStroopTemplate}>Stroop task</button>}
            {onGonogoTemplate && <button onClick={onGonogoTemplate}>Go/No-Go task</button>}
          </div>
        </div>}
      </div>
    </section>
    <section>
      <div className="section-title">
        <h2>Sessions</h2>
        <span>{sessions.length} total · showing {filteredSessions.length}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <input className="session-search" placeholder="Search sessions..." value={sessionFilter} onChange={e => handleFilterChange(e.target.value)} />
        {sessionFilter && <button onClick={() => setSessionFilter('')} style={{ position: 'absolute', right: 8, top: '50%', translate: '0 -50%', border: 0, background: 'transparent', cursor: 'pointer', fontSize: '1rem', padding: '4px 8px', lineHeight: 1 }} title="Clear search">×</button>}
      </div>
      <div className="session-table">
        {filteredSessions.length ? filteredSessions.slice(0, sessionFilter ? undefined : 20).map(item => (
          <div key={item.session_id} className="session-row">
            <span className={`session-status ${item.status}`} />
            <b>{item.participant_id}</b>
            <span>{item.protocol_name}</span>
            <span>{item.run_mode || 'formal'} · v{item.protocol_version}</span>
            <span>{item.event_count || 0} events</span>
            <time>{item.ended_at?.replace('T', ' ').slice(0, 19) || 'in progress'}</time>
            {item.integrity?.validity_status && <span className={`badge integrity-${item.integrity.validity_status}`}>{item.integrity.validity_status}</span>}
          </div>
        )) : sessionFilter ? <p className="empty">No sessions match "{sessionFilter}"</p> : <p className="empty">Completed and aborted sessions will appear here.</p>}
      </div>
    </section>
    {confirmState && <ConfirmDialog {...confirmState} />}
    {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
  </main>;
}

function ProjectCard({ versions, sessions, storageInfo, onOpen, onRun, onNextVersion, onDuplicate, onArchive, onRenameProject, onMigrate }) {
  const latest = versions[0], draft = versions.find(item => protocolStatusOf(item) === 'draft');
  const activeProtocol = draft || latest;
  const readiness = assessProtocolReadiness(activeProtocol, { sessions, storageInfo });
  const graphProtocol = isGraphProtocol(latest);
  const stepTypes = new Set(graphProtocol
    ? latest.graph.nodes.map(node => node.component.type).filter(type => !type.startsWith('core.'))
    : latest.blocks.flatMap(b => b.trials.flatMap(t => t.steps.map(s => s.type))));
  const questionnaireCount = graphProtocol ? 0 : latest.blocks.reduce((c, b) => c + b.trials.reduce((tc, t) => tc + t.steps.filter(s => s.type === 'questionnaire').length, 0), 0);
  const totalMs = estimateDuration(latest);
  const missingMedia = graphProtocol
    ? latest.graph.nodes.some(node => node.component.type === 'display.media' && !node.config?.assetId && !node.config?.sourceUrl)
    : latest.blocks.some(b => b.trials.some(t => t.steps.some(s => ['video', 'audio', 'image'].includes(s.type) && !s.source_url && !s.asset_id && !(latest.stimuli || []).some(r => r.stimulus_id === s.stimulus_id && (r.source_url || r.asset_id)))));
  const status = protocolStatusOf(latest);
  return <article className="protocol-card project-card">
    <div className="protocol-card-top">
      <span className={`badge ${status}`}>{status}</span>
      <span className={`readiness-pill ${readiness.status}`}>{readiness.score}% · {readiness.status}</span>
    </div>
    <button className="card-main" onClick={() => onOpen(activeProtocol)}>
      <h3>{protocolNameOf(latest)}</h3>
      <p>{graphProtocol ? `${latest.graph.nodes.length} nodes · ${latest.graph.edges.length} connections` : `${latest.blocks.length} blocks · ${latest.blocks.reduce((total, b) => total + b.trials.length, 0)} trials`}</p>
      <div className="protocol-summary">
        {[...stepTypes].slice(0, 5).map(t => <span key={t}>{t}</span>)}
        {questionnaireCount > 0 && <span>☷ {questionnaireCount} Q</span>}
        {formatDuration(totalMs) && <span>⏱ {formatDuration(totalMs)}</span>}
        {missingMedia && <span style={{ background: '#ffe9e6', color: '#922b24' }}>⚠ missing media</span>}
        {stepTypes.size > 5 && <span>+{stepTypes.size - 5} more</span>}
      </div>
      <small>{graphProtocol && <span className="composer-v2-tag">Composer V2 · </span>}Latest v{protocolVersionOf(latest)} · {protocolVersionLabelOf(latest)}</small>
    </button>
    <details className="readiness-details">
      <summary>Lab readiness checklist</summary>
      <div className="readiness-list">
        {readiness.items.map(item => (
          <div key={item.id} className={item.passed ? 'pass' : item.severity}>
            <b>{item.passed ? '✓' : item.severity === 'error' ? '!' : '△'} {item.label}</b>
            <span>{item.detail}</span>
            {!item.passed && <small>{item.action}</small>}
          </div>
        ))}
      </div>
    </details>
    <div className="card-actions">
      {draft ? <button className="primary" onClick={() => onOpen(draft)}>Edit draft</button> : <button onClick={() => onNextVersion(latest)}>New version</button>}
      {status === 'frozen' && <button className="primary" onClick={() => onRun(latest)}>Run latest</button>}
      <button onClick={() => onRenameProject(latest)}>Rename</button>
      {!graphProtocol && onMigrate && <button className="primary" onClick={() => onMigrate(latest)}>Migrate to Composer V2</button>}
      <button onClick={() => onDuplicate(latest)}>Duplicate project</button>
      <button onClick={() => onArchive(latest)}>Archive project</button>
    </div>
    <details className="version-history">
      <summary>Version history</summary>
      {versions.map(item => {
        const itemStatus = protocolStatusOf(item), hash = protocolConfigHashOf(item);
        return <div key={protocolIdOf(item)}><span className={`badge ${itemStatus}`}>{itemStatus}</span><b>v{protocolVersionOf(item)}</b><span>{protocolVersionLabelOf(item)}</span>{hash && <code>{hash.slice(0, 10)}…</code>}<button onClick={() => onOpen(item)}>{itemStatus === 'frozen' ? 'View' : 'Edit'}</button>{itemStatus === 'frozen' && <button onClick={() => onRun(item)}>Run</button>}</div>;
      })}
    </details>
  </article>;
}
