import { useCallback, useEffect, useMemo, useState } from 'react';
import { bundle, bundleSimple, downloadBundle } from './exporter';
import { deleteSession, loadSession, loadSessions, saveSession } from './storage';
import { AlertDialog, PromptDialog } from './Modal.jsx';
import GuidePanel from './GuidePanel.jsx';
import { OUTPUT_FILES } from './constants.js';

export default function SessionManager() {
  const [open, setOpen] = useState(false);
  const [summaries, setSummaries] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [validityFilter, setValidityFilter] = useState('all');
  const [alertState, setAlert] = useState(null);
  const [deletePrompt, setDeletePrompt] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const [guideTab, setGuideTab] = useState(null);

  const refreshSessions = useCallback(async () => {
    setListLoading(true);
    try {
      const next = await loadSessions();
      setSummaries([...next].sort((left, right) => String(right.ended_at || right.started_at || '').localeCompare(String(left.ended_at || left.started_at || ''))));
    } catch (error) {
      setAlert({ title: 'Session list unavailable', message: error.message || 'Could not load local sessions.' });
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { if (open) refreshSessions(); }, [open, refreshSessions]);

  const filteredSummaries = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return summaries.filter(item => {
      const validity = item.researcher_validity || item.integrity?.validity_status || 'unreviewed';
      if (validityFilter !== 'all' && validity !== validityFilter) return false;
      if (!query) return true;
      return [item.participant_id, item.protocol_name, item.run_mode, item.status, item.protocol_version]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [filterText, summaries, validityFilter]);

  const summaryStats = useMemo(() => ({
    total: summaries.length,
    invalid: summaries.filter(item => item.integrity?.validity_status === 'invalid' || item.researcher_validity === 'invalid').length,
    attention: summaries.filter(item => item.integrity?.validity_status === 'attention').length,
    reviewed: summaries.filter(item => item.researcher_validity && item.researcher_validity !== 'unreviewed').length,
  }), [summaries]);

  const select = async summary => {
    setLoading(true);
    try {
      const loaded = await loadSession(summary.session_id);
      if (!loaded) setAlert({ title: 'Session missing', message: 'The selected session could not be found in local storage.' });
      setDetail(loaded);
    } finally {
      setLoading(false);
    }
  };

  const saveReview = async () => {
    try {
      await saveSession(detail);
      await refreshSessions();
      setAlert({ title: 'Saved', message: 'Session review saved' });
    } catch (error) {
      setAlert({ title: 'Save failed', message: error.message || 'Could not save the session review to local storage.' });
    }
  };

  const exportData = () => { if (detail?.protocol_snapshot) downloadBundle(bundle(detail, detail.protocol_snapshot, detail.events || [], detail.responses || []), detail.participant_id); };
  const exportSimple = () => { if (detail?.protocol_snapshot) downloadBundle(bundleSimple(detail, detail.protocol_snapshot, detail.events || [], detail.responses || []), detail.participant_id); };

  const exportAll = async () => {
    setLoading(true);
    try {
      const sessions = (await Promise.all(filteredSummaries.map(s => loadSession(s.session_id)))).filter(Boolean);
      const files = {};
      let skipped = 0;
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        if (!session.protocol_snapshot) { skipped++; continue; }
        const dir = `${session.participant_id}_${session.session_id}`;
        Object.entries(bundle(session, session.protocol_snapshot, session.events || [], session.responses || [])).forEach(([name, content]) => { files[`${dir}/${name}`] = content; });
        setBatchProgress({ done: i + 1 - skipped, total: sessions.length - skipped });
        await new Promise(r => setTimeout(r, 0));
      }
      if (Object.keys(files).length) downloadBundle(files, 'physioflow_all_sessions');
      else if (skipped > 0) setAlert({ title: 'Nothing to export', message: `${skipped} session(s) skipped because their protocol snapshot was missing.` });
      else setAlert({ title: 'Nothing to export', message: 'No selected session has a complete protocol snapshot.' });
    } finally {
      setLoading(false);
      setBatchProgress(null);
    }
  };

  const remove = () => {
    if (!detail) return;
    setDeletePrompt({
      title: 'Delete session',
      message: `Type participant ID "${detail.participant_id}" to permanently delete this local session.`,
      placeholder: 'Type participant ID to confirm',
      onSubmit: async (typed) => {
        setDeletePrompt(null);
        if (typed !== detail.participant_id) { setAlert({ title: 'Mismatch', message: 'Participant ID does not match. Deletion cancelled.' }); return; }
        await deleteSession(detail.session_id);
        setDetail(null);
        await refreshSessions();
      },
      onCancel: () => setDeletePrompt(null),
    });
  };

  return <>
    <button className="manage-sessions" onClick={() => setOpen(true)}>☷ Manage sessions</button>
    {open && <div className="session-manager">
      <div className="session-manager-head">
        <div><span>SESSION DATA</span><b>Review, export and validate</b></div>
        <div>
          <button onClick={() => setGuideTab('data')}>Data format</button>
          <button onClick={() => setGuideTab('storage')}>Storage</button>
          <button disabled={!filteredSummaries.length || loading} onClick={exportAll}>Export filtered Sessions</button>
          <button disabled={listLoading} onClick={refreshSessions}>Refresh</button>
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
      <div className="session-manager-body">
        <aside>
          <div className="session-list-tools">
            <input value={filterText} onChange={event => setFilterText(event.target.value)} placeholder="Search participant, protocol..." />
            <select value={validityFilter} onChange={event => setValidityFilter(event.target.value)}>
              <option value="all">All validity</option>
              <option value="valid">Valid</option>
              <option value="attention">Attention</option>
              <option value="invalid">Invalid</option>
              <option value="exclude">Exclude</option>
              <option value="unreviewed">Unreviewed</option>
            </select>
            <div className="session-list-stats">
              <span>{summaryStats.total} total</span>
              <span>{summaryStats.reviewed} reviewed</span>
              <span>{summaryStats.attention} attention</span>
              <span>{summaryStats.invalid} invalid</span>
            </div>
          </div>
          {filteredSummaries.map(item => (
            <button className={detail?.session_id === item.session_id ? 'selected' : ''} key={item.session_id} onClick={() => select(item)}>
              <span className={`session-dot ${item.integrity?.validity_status || item.status}`} />
              <div><b>{item.participant_id}</b><small>{item.protocol_name} · {item.researcher_validity || item.integrity?.validity_status || 'unreviewed'} · v{item.protocol_version}</small></div>
              <time>{item.ended_at?.slice(0, 10)}</time>
            </button>
          ))}
          {listLoading && <p>Loading sessions...</p>}
          {!listLoading && !summaries.length && <p>No Sessions stored.</p>}
          {!listLoading && Boolean(summaries.length) && !filteredSummaries.length && <p>No Sessions match the current filter.</p>}
        </aside>
        <section>
          {loading ? <p>Loading Session…</p> : detail ? <SessionDetail detail={detail} setDetail={setDetail} onSave={saveReview} onExport={exportData} onExportSimple={exportSimple} onDelete={remove} /> : <div className="session-placeholder"><b>Select a Session</b><p>The complete event history and answers are stored in the active local storage backend, separate from the lightweight dashboard index.</p></div>}
        </section>
      </div>
      {batchProgress && <div className="batch-progress"><span>Exporting {batchProgress.done}/{batchProgress.total} sessions...</span><i style={{ flex: 1 }}><span style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%`, display: 'block', height: '100%', background: 'var(--lime)', borderRadius: 2 }} /></i></div>}
    </div>}
    {alertState && <AlertDialog {...alertState} onClose={() => setAlert(null)} />}
    {deletePrompt && <PromptDialog {...deletePrompt} />}
    {guideTab && <GuidePanel initialTab={guideTab} onClose={() => setGuideTab(null)} />}
  </>;
}

function SessionDetail({ detail, setDetail, onSave, onExport, onExportSimple, onDelete }) {
  const integrity = detail.integrity || {};
  return <div className="session-detail">
    <div className="session-detail-title">
      <div>
        <span className={`integrity-badge ${integrity.validity_status}`}>{integrity.validity_status || 'not checked'}</span>
        <h2>{detail.participant_id}</h2>
        <p>{detail.protocol_name} · Version {detail.protocol_version}</p>
      </div>
      <button className="primary" onClick={onExportSimple}>Export simplified data</button>
      <button onClick={onExport}>Export complete (advanced)</button>
    </div>
    <div className="session-metrics">
      <div><b>{detail.events?.length || 0}</b><span>events</span></div>
      <div><b>{detail.responses?.length || 0}</b><span>responses</span></div>
      <div><b>{detail.runtime_snapshot?.completed_steps?.length || 0}</b><span>completed Steps</span></div>
    </div>
    <div className="integrity-list">
      <h3>Automatic integrity check</h3>
      {integrity.errors?.map(m => <p className="integrity-error" key={m}>× {m}</p>)}
      {integrity.warnings?.map(m => <p className="integrity-warning" key={m}>△ {m}</p>)}
      {!integrity.errors?.length && !integrity.warnings?.length && <p className="integrity-ok">✓ No integrity issue detected</p>}
    </div>
    <div className="session-export-note">
      <div>
        <h3>Export package</h3>
        <p>The complete bundle includes raw events, responses, derived analysis windows, protocol snapshot, integrity report, and a data dictionary.</p>
      </div>
      <div className="session-export-files">
        {OUTPUT_FILES.slice(0, 6).map(([file]) => <code key={file}>{file}</code>)}
        <code>+{Math.max(0, OUTPUT_FILES.length - 6)} more</code>
      </div>
    </div>
    <label htmlFor="researcher-validity">Researcher validity
      <select id="researcher-validity" value={detail.researcher_validity || 'unreviewed'} onChange={e => setDetail({ ...detail, researcher_validity: e.target.value })}>
        <option value="unreviewed">Unreviewed</option>
        <option value="valid">Valid</option>
        <option value="invalid">Invalid</option>
        <option value="exclude">Exclude from analysis</option>
      </select>
    </label>
    <label htmlFor="researcher-notes">Researcher notes
      <textarea id="researcher-notes" value={detail.notes || ''} onChange={e => setDetail({ ...detail, notes: e.target.value })} />
    </label>
    <div className="session-review-actions">
      <button className="primary" onClick={onSave}>Save review</button>
    </div>
    <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
      <small style={{ display: 'block', marginBottom: '.5rem', color: '#7b867f' }}>Danger zone</small>
      <button className="danger" onClick={onDelete}>Delete Session</button>
    </div>
  </div>;
}
