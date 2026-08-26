import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { applyThemeToDOM, resetThemeToDOM } from './theme.js';
import { createNextProtocolVersion, duplicateProtocolAsProject, freezeProtocol, unfreezeProtocol, validateProtocol } from './domain';
import { clearCurrentRun, getStorageInfo, loadCurrentRunAsync, loadProtocols, loadSessions, openDataDirectory, saveProtocols, selectDataDirectory } from './storage';
import Dashboard from './Dashboard.jsx';
import { ConfirmDialog, AlertDialog, PromptDialog } from './Modal.jsx';
import PreRunChecklist from './PreRunChecklist.jsx';
import Onboarding from './Onboarding.jsx';
import {
  archiveProtocol,
  createNextGraphProtocolVersion,
  createEmotionGraphTemplate,
  createGonogoGraphTemplate,
  createProtocolGraph,
  createStroopGraphTemplate,
  createId,
  duplicateGraphProtocolAsProject,
  freezeProtocolGraph,
  isGraphProtocol,
  projectIdOf,
  protocolArchivedAtOf,
  protocolIdOf,
  protocolNameOf,
  protocolStatusOf,
  renameProtocol,
  validateProtocolGraph,
} from './core/index.js';
import { createProjectComponentRegistry } from './sdk/index.js';
import { migrateLegacyProtocolV1 } from './legacy/migrateProtocolV1.js';
import { useGlobalShortcuts } from './app/useGlobalShortcuts.js';
import { useUndoRedo } from './app/useUndoRedo.js';
import { Builder } from './app/legacyBuilder.jsx';
import { GraphSessionSetup, ResumeBanner, SessionSetup } from './app/sessionSetup.jsx';
import { clone, saveFile, showToast } from './app/uiHelpers.js';

// Lazy-loaded for code splitting
const Analytics = lazy(() => import('./Analytics.jsx'));
const GuidePanel = lazy(() => import('./GuidePanel.jsx'));
const ComposerV2 = lazy(() => import('./ComposerV2.jsx'));
const FlowWorkspaceOverlay = lazy(() => import('./FlowWorkspaceOverlay.jsx'));
const GraphRuntimeRunnerPage = lazy(() => import('./GraphRuntimeRunnerPage.jsx'));
const RunnerPage = lazy(() => import('./RuntimeRunnerPage.jsx'));
const SessionManager = lazy(() => import('./SessionManager.jsx'));

const LoadingFallback = () => <div style={{ position:'fixed',inset:0,zIndex:2000,display:'grid',placeItems:'center',background:'var(--surface)' }}><span style={{ color:'var(--muted)',fontSize:'.9rem' }}>Loading…</span></div>;

export default function App() {
  const [view, setView] = useState('home');
  const [viewMode, setViewMode] = useState('visual');
  const [protocols, setProtocols] = useState([]);
  const [current, setCurrent] = useState(null);
  const [saveAnim, setSaveAnim] = useState(false);
  const saveTimer = useRef(null);
  const [run, setRun] = useState(null);
  const [recoverable, setRecoverable] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [storageInfo, setStorageInfo] = useState({ supported: false, selected: false, name: '', permission: 'missing' });
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState('workflow');
  const [builderFocusTarget, setBuilderFocusTarget] = useState(null);

  // Undo/redo
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const lastSaved = useRef([]);
  const dataLoaded = useRef(false);
  const { undoStack, setUndoStack, redoStack, setRedoStack, undoThrottle, pushUndo, undo, redo, beginScope, endScope } = useUndoRedo({ current, setCurrent, setHasUnsaved });

  // Editor undo/redo scope: the editor workflow (builder, test-run setup and
  // runner) owns one undo session. Leaving it for home/analytics discards the
  // session's history so it never leaks into global navigation history (W5).
  const editorSessionRef = useRef(false);
  useEffect(() => {
    const inEditor = view === 'builder' || view === 'setup' || view === 'runner';
    if (inEditor && !editorSessionRef.current) beginScope();
    else if (!inEditor && editorSessionRef.current) endScope();
    editorSessionRef.current = inEditor;
  }, [view, beginScope, endScope]);

  // Onboarding
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const ONBOARDING_KEY = 'physioflow.onboarding-v1';
  // Load data from storage on mount
  useEffect(() => {
    (async () => {
      const [p, s, r] = await Promise.all([
        loadProtocols(),
        loadSessions(),
        loadCurrentRunAsync(),
      ]);
      setProtocols(p);
      setSessions(s);
      if (r) setRecoverable(r);
      setStorageInfo(await getStorageInfo());
      // Show onboarding on first visit
      try {
        if (!p.length && !s.length && localStorage.getItem(ONBOARDING_KEY) !== '1') {
          localStorage.setItem(ONBOARDING_KEY, '1');
          setOnboardingOpen(true);
        }
      } catch { /* ignore */ }
      lastSaved.current = clone(p);
      dataLoaded.current = true;
    })().catch(console.warn);
  }, []);

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  // Alert
  const [alertState, setAlert] = useState(null);
  // Prompt
  const [promptState, setPrompt] = useState(null);
  // Pre-run checklist
  const [preRunCheck, setPreRunCheck] = useState(null);


  // beforeunload
  useEffect(() => {
    const handler = (e) => { if (hasUnsaved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  const handleBackFromBuilder = useCallback(() => {
    if (hasUnsaved) {
      setDeleteConfirm({
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Discard them and return to projects?',
        confirmLabel: 'Discard & Leave',
        danger: true,
        onConfirm: () => { setCurrent(null); setView('home'); setHasUnsaved(false); setUndoStack([]); setRedoStack([]); setDeleteConfirm(null); },
        onCancel: () => setDeleteConfirm(null),
      });
    } else {
      setView('home');
    }
  }, [hasUnsaved]);

  // Keyboard shortcuts — refs to avoid stale closures
  const viewRef = useRef(view);
  const currentRef = useRef(current);
  useEffect(() => { viewRef.current = view; currentRef.current = current; }, [view, current]);

  // Apply protocol theme when loaded
  const currentProtocolId = current && protocolIdOf(current);
  const currentTheme = current?.theme;
  useEffect(() => {
    if (currentTheme) { applyThemeToDOM(currentTheme); }
    else { resetThemeToDOM(); }
    return () => { resetThemeToDOM(); };
  }, [currentProtocolId, currentTheme]);

  const showProtocolSaveError = useCallback(error => {
    setAlert({
      title: 'Save failed',
      message: error?.message || 'Could not write protocol data to the active storage location. Check local folder permission, storage quota, or export the protocol before continuing.',
    });
  }, []);

  const persist = useCallback(async items => {
    await saveProtocols(items);
    setProtocols(items);
    lastSaved.current = clone(items);
  }, []);

  const open = value => {
    if (current && hasUnsaved && view === 'builder') {
      setDeleteConfirm({
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Save before opening another protocol?',
        confirmLabel: 'Save & Open',
        danger: false,
        onConfirm: async () => {
          if (!await handleSave(current)) return;
          setDeleteConfirm(null);
          setCurrent(clone(value));
          setHasUnsaved(false);
          setUndoStack([]);
          setRedoStack([]);
        },
        onCancel: () => setDeleteConfirm(null),
      });
      return;
    }
    setCurrent(clone(value));
    setView('builder');
    setHasUnsaved(false);
    setUndoStack([]);
    setRedoStack([]);
  };

  const handleSave = useCallback(async value => {
    const valueId = protocolIdOf(value);
    const index = protocols.findIndex(item => protocolIdOf(item) === valueId);
    const next = index < 0 ? [...protocols, value] : protocols.map(item => protocolIdOf(item) === valueId ? value : item);
    try {
      await persist(next);
    } catch (error) {
      showProtocolSaveError(error);
      return false;
    }
    setCurrent(value);
    setHasUnsaved(false);
    lastSaved.current = clone(next);
    setSaveAnim(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveAnim(false), 1500);
    showToast('Protocol saved');
    return true;
  }, [persist, protocols, showProtocolSaveError]);

  const addAndOpen = async value => {
    try {
      await persist([...protocols, value]);
      open(value);
    } catch (error) {
      showProtocolSaveError(error);
    }
  };

  // Keyboard shortcuts — refs avoid stale closures; must come after handleSave/undo/redo
  useGlobalShortcuts({ viewRef, currentRef, onSave: handleSave, onUndo: undo, onRedo: redo });

  const archive = value => {
    setDeleteConfirm({
      title: 'Archive project?',
      message: `Archive project "${protocolNameOf(value)}" and all of its versions?`,
      confirmLabel: 'Archive',
      danger: false,
      onConfirm: async () => {
        const archivedAt = new Date().toISOString();
        try {
          await persist(protocols.map(item => projectIdOf(item) === projectIdOf(value) ? archiveProtocol(item, archivedAt) : item));
          setDeleteConfirm(null);
          showToast('Project archived');
        } catch (error) {
          showProtocolSaveError(error);
        }
      },
      onCancel: () => setDeleteConfirm(null),
    });
  };

  const renameProject = value => {
    setPrompt({
      title: 'Rename project',
      message: `Enter a new name for "${protocolNameOf(value)}"`,
      placeholder: 'Project name',
      defaultValue: protocolNameOf(value),
      onSubmit: async name => {
        setPrompt(null);
        if (!name || name === protocolNameOf(value)) return;
        const draft = protocols.find(item => projectIdOf(item) === projectIdOf(value) && protocolStatusOf(item) === 'draft' && !protocolArchivedAtOf(item));
        if (draft) {
          const renamed = renameProtocol(draft, name);
          try {
            await persist(protocols.map(item => protocolIdOf(item) === protocolIdOf(draft) ? renamed : item));
            if (current && protocolIdOf(current) === protocolIdOf(draft)) setCurrent(renamed);
          } catch (error) {
            showProtocolSaveError(error);
          }
        } else {
          const next = isGraphProtocol(value) ? createNextGraphProtocolVersion(value) : createNextProtocolVersion(value);
          if (isGraphProtocol(next)) next.metadata.name = name;
          else next.name = name;
          addAndOpen(next);
        }
      },
      onCancel: () => { setPrompt(null); },
    });
  };

  const migrateProtocol = async value => {
    try {
      const { protocol: migrated, report } = migrateLegacyProtocolV1(value, { idFactory: createId });
      await addAndOpen(migrated);
      setAlert({ title: 'Migration complete', message: `${report.counts.steps} steps inspected · ${report.coverage.mappedPercent}% mapped to native V2 components · ${report.issues.length} review item(s). The migrated version remains a safe editable draft until reviewed.` });
    } catch (error) {
      setAlert({ title: 'Migration failed', message: error.message });
    }
  };

  const chooseDataDirectory = async () => {
    try {
      await selectDataDirectory();
      const [p, s, r, info] = await Promise.all([
        loadProtocols(),
        loadSessions(),
        loadCurrentRunAsync(),
        getStorageInfo(),
      ]);
      setProtocols(p);
      setSessions(s);
      setRecoverable(r);
      setStorageInfo(info);
      lastSaved.current = clone(p);
      showToast(`Using local folder: ${info.name}`);
    } catch (error) {
      setAlert({ title: 'Local folder unavailable', message: error.message || 'Could not choose a local data folder. Use Chrome or Edge, then try again.' });
    }
  };

  const openDataFolder = async () => {
    try {
      await openDataDirectory();
    } catch (error) {
      setAlert({ title: 'Could not open folder', message: error.message || 'Open the data folder from your file manager.' });
    }
  };

  const openGuide = useCallback((tab = 'workflow') => {
    setGuideTab(tab);
    setGuideOpen(true);
  }, []);

  const focusPreRunIssue = useCallback(target => {
    if (preRunCheck) setCurrent(preRunCheck);
    setPreRunCheck(null);
    setViewMode('visual');
    setView('builder');
    setBuilderFocusTarget({ ...target, nonce: Date.now() });
  }, [preRunCheck]);

  const handlePreRunContinue = useCallback(() => {
    setRun(preRunCheck); setView('setup'); setPreRunCheck(null);
  }, [preRunCheck]);

  const handleRunDone = useCallback(async () => {
    setRecoverable(null);
    try {
      setSessions(await loadSessions());
    } catch (error) {
      setAlert({ title: 'Session list unavailable', message: error.message || 'The completed session was saved, but the dashboard could not refresh its session list.' });
    } finally {
      setView('home');
    }
  }, []);


  if (view === 'builder' && current) {
    if (isGraphProtocol(current)) {
      return <>
        <Suspense fallback={<LoadingFallback />}><ComposerV2
          protocol={current}
          onChange={(next, shouldRecord = true) => {
            if (shouldRecord) {
              const now = Date.now();
              if (now - undoThrottle.current > 300) pushUndo(clone(current), true);
              undoThrottle.current = now;
            }
            setCurrent(next);
            setHasUnsaved(true);
          }}
          onSave={handleSave}
          onBack={handleBackFromBuilder}
          onExport={() => saveFile(`${protocolNameOf(current)}.protocol-graph.json`, JSON.stringify(current, null, 2))}
          onPreview={() => {
            const check = validateProtocolGraph(current, createProjectComponentRegistry(current));
            if (check.valid) { setRun(current); setView('setup'); }
          }}
          onFreeze={async () => {
            try {
              const frozen = await freezeProtocolGraph(current, createProjectComponentRegistry(current));
              setCurrent(frozen);
              if (await handleSave(frozen)) showToast('Protocol Graph frozen');
            } catch (error) { setAlert({ title: 'Cannot freeze', message: error.message }); }
          }}
          onCreateDraft={() => addAndOpen(createNextGraphProtocolVersion(current))}
          onHostedRun={({ client, session, protocol: hostedProtocol, resources }) => {
            setRun({
              protocol: hostedProtocol || current,
              session: {
                session_id: session.sessionId,
                participant_id: session.participantId,
                operator_id: 'local-owner',
                participant_language: 'en',
                protocol_id: session.protocolId,
                protocol_version: session.protocolVersion,
                protocol_hash: session.configHash,
                protocol_name: protocolNameOf(hostedProtocol || current),
                run_mode: 'hosted',
                status: 'ready',
                started_at: session.createdAt,
                ended_at: null,
              },
              hosted: { client, session, resources },
            });
            setView('runner');
          }}
          onUndo={undo}
          onRedo={redo}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          hasUnsaved={hasUnsaved}
          saveAnim={saveAnim}
        /></Suspense>
        {deleteConfirm && <ConfirmDialog {...deleteConfirm} />}
        {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
        {promptState && <PromptDialog {...promptState} />}
      </>;
    }
    if (viewMode === 'visual') {
      return <div className="visual-editor-shell">
        <Suspense fallback={<LoadingFallback />}><FlowWorkspaceOverlay
          protocol={current} onChange={(cv, shouldRecord = true) => {
            if (shouldRecord) {
              const now = Date.now();
              if (now - undoThrottle.current > 300) pushUndo(clone(current), true);
              undoThrottle.current = now;
            }
            setCurrent(cv);
          }} onSave={handleSave}
          onBack={handleBackFromBuilder}
          onExport={() => saveFile(`${current.name}.protocol.json`, JSON.stringify(current, null, 2))}
          onFreeze={current.status !== 'frozen' ? async () => {
            const check = validateProtocol(current);
            if (check.valid) {
              try {
                const frozen = await freezeProtocol(current);
                setCurrent(frozen);
                if (await handleSave(frozen)) showToast('Protocol frozen — now immutable');
              } catch (err) {
                showToast('Cannot freeze: ' + err.message);
              }
            } else { setPreRunCheck(current); }
          } : null}
          onUnfreeze={current.status === 'frozen' ? async () => {
            const draft = unfreezeProtocol(current);
            setCurrent(draft);
            if (await handleSave(draft)) showToast('Protocol unfrozen — editable again');
          } : null}
          onTestRun={() => {
            const check = validateProtocol(current);
            if (check.valid && current.status !== 'frozen') { setRun(current); setView('setup'); } else { setPreRunCheck(current); }
          }}
          onSwitchText={() => setViewMode('text')}
          hasUnsaved={hasUnsaved}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onUndo={undo}
          onRedo={redo}
          saveAnim={saveAnim}
          onGuide={openGuide}
          focusTarget={builderFocusTarget}
        /></Suspense>
        {deleteConfirm && <ConfirmDialog {...deleteConfirm} />}
        {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
        {promptState && <PromptDialog {...promptState} />}
        {guideOpen && <Suspense fallback={null}><GuidePanel initialTab={guideTab} onClose={() => setGuideOpen(false)} /></Suspense>}
        {preRunCheck && <PreRunChecklist protocol={preRunCheck} storageInfo={storageInfo} onChooseDataDirectory={chooseDataDirectory} onClose={() => setPreRunCheck(null)} onContinue={handlePreRunContinue} onFix={focusPreRunIssue} />}
      </div>;
    } else {
      return <>
        <Builder
          value={current}
          onChange={(cv, shouldRecord = true) => {
            if (shouldRecord) {
              const now = Date.now();
              if (now - undoThrottle.current > 300) pushUndo(clone(current), true);
              undoThrottle.current = now;
            }
            setCurrent(cv);
          }}
          onSave={handleSave}
          onBack={handleBackFromBuilder}
          onRun={value => {
            const check = validateProtocol(value);
            if (check.valid && value.status !== 'frozen') { setRun(value); setView('setup'); } else { setPreRunCheck(value); }
          }}
          undo={undo}
          redo={redo}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          saveAnim={saveAnim}
          hasUnsaved={hasUnsaved}
          onSwitchToVisual={() => setViewMode('visual')}
          onGuide={openGuide}
          onUnfreeze={current.status === 'frozen' ? async () => {
            const draft = unfreezeProtocol(current);
            setCurrent(draft);
            if (await handleSave(draft)) showToast('Protocol unfrozen — editable again');
          } : null}
        />
        {deleteConfirm && <ConfirmDialog {...deleteConfirm} />}
        {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
        {promptState && <PromptDialog {...promptState} />}
        {guideOpen && <Suspense fallback={null}><GuidePanel initialTab={guideTab} onClose={() => setGuideOpen(false)} /></Suspense>}
        {preRunCheck && <PreRunChecklist protocol={preRunCheck} storageInfo={storageInfo} onChooseDataDirectory={chooseDataDirectory} onClose={() => setPreRunCheck(null)} onContinue={handlePreRunContinue} onFix={focusPreRunIssue} />}
      </>;
    }
  }

  if (view === 'setup' && run) {
    const SetupComponent = isGraphProtocol(run) ? GraphSessionSetup : SessionSetup;
    return <SetupComponent
      protocol={run}
      onBack={() => setView(run.status === 'frozen' ? 'home' : 'builder')}
      onStart={session => { setRun({ protocol: run, session }); setView('runner'); }}
      storageInfo={storageInfo}
      onChooseDataDirectory={chooseDataDirectory}
      onGuide={openGuide}
      guideOpen={guideOpen}
      guideTab={guideTab}
      onCloseGuide={() => setGuideOpen(false)}
    />;
  }

  if (view === 'runner' && run?.protocol) {
    const RunnerComponent = isGraphProtocol(run.protocol) ? GraphRuntimeRunnerPage : RunnerPage;
    return <Suspense fallback={<LoadingFallback />}><RunnerComponent data={run} onDone={handleRunDone} /></Suspense>;
  }

  if (view === 'analytics') {
    return <>
      <Suspense fallback={<LoadingFallback />}><Analytics onBack={() => setView('home')} initialSessions={sessions} onGuide={openGuide} /></Suspense>
      {guideOpen && <Suspense fallback={null}><GuidePanel initialTab={guideTab} onClose={() => setGuideOpen(false)} /></Suspense>}
    </>;
  }

  return <>
    <Dashboard
      protocols={protocols}
      sessions={sessions}
      onOpen={open}
      onNew={() => addAndOpen(createProtocolGraph())}
      onTemplate={() => addAndOpen(createEmotionGraphTemplate())}
      onStroopTemplate={(cfg) => addAndOpen(createStroopGraphTemplate(cfg || {}))}
      onGonogoTemplate={(cfg) => addAndOpen(createGonogoGraphTemplate(cfg || {}))}
      onImport={addAndOpen}
      onRun={value => { setPreRunCheck(value); }}
      onNextVersion={value => addAndOpen(isGraphProtocol(value) ? createNextGraphProtocolVersion(value) : createNextProtocolVersion(value))}
      onDuplicate={value => addAndOpen(isGraphProtocol(value) ? duplicateGraphProtocolAsProject(value) : duplicateProtocolAsProject(value))}
      onArchive={archive}
      onRenameProject={renameProject}
      onMigrate={migrateProtocol}
      onAnalytics={() => setView('analytics')}
      storageInfo={storageInfo}
      onChooseDataDirectory={chooseDataDirectory}
      onOpenDataFolder={openDataFolder}
      onGuide={openGuide}
    />
    <Suspense fallback={null}><SessionManager /></Suspense>
    {recoverable && <ResumeBanner
      snapshot={recoverable}
      onResume={() => { setRun({ protocol: recoverable.protocol, session: recoverable.session, restore: recoverable }); setView('runner'); }}
      onDiscard={() => {
        setDeleteConfirm({
          title: 'Discard recovery?',
          message: 'Discard this unfinished Session and its recovery snapshot?',
          confirmLabel: 'Discard',
          danger: true,
          onConfirm: () => { clearCurrentRun(); setRecoverable(null); setDeleteConfirm(null); },
          onCancel: () => setDeleteConfirm(null),
        });
      }}
    />}
    {deleteConfirm && <ConfirmDialog {...deleteConfirm} />}
    {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
    {promptState && <PromptDialog {...promptState} />}
    {preRunCheck && <PreRunChecklist protocol={preRunCheck} storageInfo={storageInfo} onChooseDataDirectory={chooseDataDirectory} onClose={() => setPreRunCheck(null)} onContinue={handlePreRunContinue} onFix={focusPreRunIssue} />}
    {guideOpen && <Suspense fallback={null}><GuidePanel initialTab={guideTab} onClose={() => setGuideOpen(false)} /></Suspense>}
    {onboardingOpen && <Onboarding onClose={() => setOnboardingOpen(false)} />}
  </>;
}
