// Top toolbar of the FlowCanvas editor: view switch, undo/redo, auto layout,
// fit view, flow snapshots and validation status.
export default function CanvasToolbar({ viewMode, setViewMode, trial, flow, focusMessage, focusHighlightStepId, setFocusHighlightStepId, setFocusMessage, dragConnection, setDragConnection, snapEnabled, setSnapEnabled, performUndo, performRedo, autoLayout, fitView, snapshots, snapshotsOpen, setSnapshotsOpen, saveSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot, check, t }) {
  return (
    <div className="canvas-bar">
      <div className="view-toggle" role="tablist" aria-label="Editor view">
        <button type="button" role="tab" aria-selected={viewMode === 'canvas'} className={viewMode === 'canvas' ? 'active' : ''} onClick={() => setViewMode('canvas')}>Canvas</button>
        <button type="button" role="tab" aria-selected={viewMode === 'code'} className={viewMode === 'code' ? 'active' : ''} onClick={() => setViewMode('code')}>Code</button>
      </div>
      <div><b>{trial.name}</b><span>{flow.nodes.length} nodes · {flow.edges.length} connections</span></div>
      <div className={`connection-hint ${focusMessage ? 'focus-warning' : ''}`}>
        {focusMessage ? <span>{focusMessage} {focusHighlightStepId && <button onClick={() => { setFocusHighlightStepId(null); setFocusMessage(''); }} style={{ fontSize: '.7rem', padding: '.15rem .5rem', marginLeft: '.5rem' }}>知道了</button>}</span> : dragConnection ? <>Connect <strong>{dragConnection.branch}</strong> → <button onClick={() => setDragConnection(null)}>Cancel</button></> : null}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={snapEnabled} onChange={e => { setSnapEnabled(e.target.checked); try { localStorage.setItem('physioflow.snap', e.target.checked ? '1' : '0'); } catch {} }} /> Snap
      </label>
      <button className="icon-btn" onClick={performUndo} title={t('Undo (⌘Z)')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4L3 9l6 5" /><path d="M3 9h11a6 6 0 0 1 0 12h-3" /></svg></button>
      <button className="icon-btn" onClick={performRedo} title={t('Redo (⌘⇧Z)')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4l6 5-6 5" /><path d="M21 9H10a6 6 0 0 0 0 12h3" /></svg></button>
      <button onClick={autoLayout}>Auto layout</button>
      <button className="icon-btn" onClick={fitView} title={t('Fit view')}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5" /><path d="M15 4h5v5" /><path d="M20 15v5h-5" /><path d="M9 20H4v-5" /></svg></button>
      <div style={{ position: 'relative' }}>
        <button onClick={() => setSnapshotsOpen(o => !o)} title="Flow snapshots">{snapshots.length > 0 ? `📸 ${snapshots.length}` : '📸'}</button>
        {snapshotsOpen && <div className="snapshots-dropdown" style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 8, padding: '.5rem', minWidth: 240, maxHeight: 320, overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.3rem .5rem' }}>
            <b style={{ fontSize: '.78rem' }}>Flow snapshots</b>
            <button onClick={() => { saveSnapshot(); setSnapshotsOpen(true); }} style={{ fontSize: '.72rem', padding: '.25rem .5rem' }}>+ Save</button>
          </div>
          {snapshots.length === 0 && <p style={{ padding: '.5rem', color: 'var(--muted)', fontSize: '.78rem' }}>No snapshots yet. Save a snapshot to preserve your current flow layout.</p>}
          {snapshots.map((s, _i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.35rem .5rem', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: '.72rem', flex: 1 }} title={s.created_at}>{s.name}</span>
              <small style={{ color: 'var(--muted)', fontSize: '.65rem' }}>{s.created_at?.slice(11, 19) || ''}</small>
              <button onClick={() => restoreSnapshot(s)} style={{ fontSize: '.68rem', padding: '.2rem .4rem' }} title="Restore">↩</button>
              <button onClick={() => { const name = window.prompt('Snapshot name:', s.name); if (name) renameSnapshot(s.id, name); }} style={{ fontSize: '.68rem', padding: '.2rem .4rem' }} title="Rename">✎</button>
              <button onClick={() => deleteSnapshot(s.id)} className="danger" style={{ fontSize: '.68rem', padding: '.2rem .4rem' }} title="Delete">×</button>
            </div>
          ))}
        </div>}
      </div>
      <span className={check.valid ? 'flow-status valid' : 'flow-status invalid'} title={check.errors.concat(check.warnings).slice(0, 5).join('\n')}>{check.valid ? '✓ Ready' : `! ${check.errors.length} issues`}</span>
    </div>
  );
}
