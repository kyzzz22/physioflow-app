import { useEffect, useMemo, useRef, useState } from 'react';
import FlowCanvas from './FlowCanvas';
import ResourceLibrary from './ResourceLibrary';
import HierarchyManager from './HierarchyManager';
import QuestionnaireLibrary from './QuestionnaireLibrary';
import { stepContentIssues } from './domain';
import { LanguageToggle, DarkModeToggle } from './i18n';

export default function FlowWorkspaceOverlay({ protocol, onChange, onSave, onBack, onExport, onFreeze, onUnfreeze, onTestRun, onSwitchText, hasUnsaved, canUndo, canRedo, onUndo, onRedo, saveAnim, onGuide, focusTarget }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [protoName, setProtoName] = useState(protocol.name);
  const trials = useMemo(() => protocol.blocks.flatMap((block, bi) => block.trials.map((trial, ti) => ({ block, blockIndex: bi, trial, trialIndex: ti }))), [protocol]);
  const [selectedId, setSelectedId] = useState(trials[0]?.trial.trial_id || '');
  const selected = trials.find(t => t.trial.trial_id === selectedId) || trials[0];

  useEffect(() => {
    if (!focusTarget) return;
    const targetTrial = focusTarget.trial_id || protocol.blocks?.[focusTarget.blockIndex]?.trials?.[focusTarget.trialIndex]?.trial_id;
    if (targetTrial) setSelectedId(targetTrial);
  }, [focusTarget, protocol.blocks]);

  // Always reference the latest protocol to avoid React batching races
  const protoRef = useRef(protocol);
  useEffect(() => { protoRef.current = protocol; }, [protocol]);

  const cloneLatest = () => structuredClone(protoRef.current);

  // Sync name on every keystroke to avoid Ctrl+S saving stale name
  const handleNameChange = name => {
    setProtoName(name);
    const next = cloneLatest();
    next.name = name;
    next.updated_at = new Date().toISOString();
    onChange(next, false);
  };

  const updateTrial = nextTrial => {
    if (protocol.status === 'frozen') return;
    const next = cloneLatest();
    next.blocks[selected.blockIndex].trials[selected.trialIndex] = nextTrial;
    next.updated_at = new Date().toISOString();
    onChange(next);
  };

  const handleSave = () => {
    const next = cloneLatest();
    next.name = protoName;
    next.updated_at = new Date().toISOString();
    onChange(next);
    onSave(next);
  };

  const commitName = () => {
    if (protocol.status === 'frozen') return;
    const next = cloneLatest();
    next.name = protoName;
    next.updated_at = new Date().toISOString();
    onChange(next);
  };

  // Per-trial issue counts
  const trialIssues = useMemo(() => {
    const map = {};
    const stimuli = protocol.stimuli || [];
    const questionnaires = protocol.questionnaires || [];
    trials.forEach(({ trial }) => {
      const issues = [];
      trial.steps.forEach(step => {
        const si = stepContentIssues(step, stimuli, questionnaires);
        if (si.some(i => i.kind === 'error')) issues.push('error');
        else if (si.some(i => i.kind === 'warn')) issues.push('warn');
      });
      map[trial.trial_id] = issues;
    });
    return map;
  }, [trials, protocol.stimuli, protocol.questionnaires]);

  return <>
    <div className="flow-overlay">
      <div className="flow-overlay-head">
        {/* Left: back + logo + name + unsaved indicator */}
        <div className="flow-head-left">
          {onBack && <button onClick={onBack} title="Back to projects" className="icon-btn">←</button>}
          <div className="flow-project">
            <span className="flow-logo">PF</span>
            <input
              value={protoName}
              disabled={protocol.status === 'frozen'}
              onChange={e => handleNameChange(e.target.value)}
              onBlur={commitName}
              style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: '.9rem', fontWeight: 700, width: '180px', padding: 0 }}
              title="Project name"
            />
            {hasUnsaved && <small className="unsaved-dot">●</small>}
          </div>
        </div>

        {/* Center: Trial switcher */}
        <select className="trial-switcher" value={selected?.trial.trial_id || ''} onChange={e => setSelectedId(e.target.value)} title="Select trial to edit">
          {trials.map(({ block, trial }) => {
            const iss = trialIssues[trial.trial_id] || [];
            return <option value={trial.trial_id} key={trial.trial_id}>
              {block.name} / {trial.name}{iss.includes('error') ? ' ⚠' : iss.includes('warn') ? ' △' : ''}
            </option>;
          })}
        </select>

        {/* Right: undo/redo + save + language + badge + actions */}
        <div className="flow-top-actions">
          {canUndo !== undefined && <button className="hint" disabled={!canUndo} onClick={onUndo} title="Ctrl+Z">↩</button>}
          {canRedo !== undefined && <button className="hint" disabled={!canRedo} onClick={onRedo} title="Ctrl+Shift+Z">↪</button>}
          <button className={`hint save-flow-btn${saveAnim ? ' saved' : ''}`} onClick={handleSave} title="Ctrl+S">{saveAnim ? 'Saved' : 'Save flow'}</button>
          <button className="hint" onClick={() => onGuide?.('nodes')} title="Node manual">?</button>
          <DarkModeToggle />
          <LanguageToggle />
          <span className={`badge ${protocol.status}`}>{protocol.status}</span>
          {onTestRun && <button className="primary" onClick={onTestRun} title="Test run">Run</button>}

          {/* Overflow menu for secondary actions */}
          <div className="overflow-menu" style={{ position: 'relative' }}>
            <button onClick={() => setOverflowOpen(o => !o)} title="More actions" className="hint">⋯</button>
            {overflowOpen && <>
              <div className="overflow-backdrop" onClick={() => setOverflowOpen(false)} />
              <div className="overflow-dropdown">
                <button onClick={() => { setHierarchyOpen(true); setOverflowOpen(false); }}>Blocks &amp; Trials</button>
                <button onClick={() => { setLibraryOpen(true); setOverflowOpen(false); }}>Stimuli library</button>
                <button onClick={() => { setQuestionnaireOpen(true); setOverflowOpen(false); }}>Questionnaire library</button>
                <button onClick={() => { onGuide?.('workflow'); setOverflowOpen(false); }}>Built-in guide</button>
                <button onClick={() => { onGuide?.('data'); setOverflowOpen(false); }}>Data format</button>
                {onExport && <button onClick={() => { onExport(); setOverflowOpen(false); }}>Export JSON</button>}
                {protocol.status !== 'frozen' && onFreeze && <button onClick={() => { onFreeze(); setOverflowOpen(false); }}>Freeze version</button>}
                {protocol.status === 'frozen' && onUnfreeze && <button onClick={() => { onUnfreeze(); setOverflowOpen(false); }}>Unfreeze version</button>}
                {onSwitchText && <button onClick={() => { onSwitchText(); setOverflowOpen(false); }}>Advanced settings</button>}
              </div>
            </>}
          </div>
        </div>
      </div>

      {selected
        ? <FlowCanvas trial={selected.trial} stimuli={protocol.stimuli || []} questionnaires={protocol.questionnaires || []} disabled={protocol.status === 'frozen'} onChange={updateTrial} focusTarget={focusTarget} />
        : <div className="empty" style={{ padding: '3rem', textAlign: 'center' }}>Add a Trial before opening the workflow.</div>
      }
    </div>

    {hierarchyOpen && <HierarchyManager protocol={protocol} onChange={onChange} onClose={() => setHierarchyOpen(false)} onSelect={setSelectedId} />}
    {libraryOpen && <ResourceLibrary protocol={protocol} onChange={onChange} onClose={() => setLibraryOpen(false)} />}
    {questionnaireOpen && <QuestionnaireLibrary protocol={protocol} onChange={onChange} onClose={() => setQuestionnaireOpen(false)} />}
  </>;
}
