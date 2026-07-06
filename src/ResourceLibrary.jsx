import { useEffect, useRef, useState } from 'react';
import { saveAsset } from './assetStore.js';
import { ConfirmDialog } from './Modal.jsx';

const createResource = () => ({
  stimulus_id: `stimulus_${crypto.randomUUID()}`, name: 'New stimulus', type: 'video',
  source_mode: 'url', source_url: '', asset_id: '', file_name: '', mime_type: '', file_size: '', checksum: '', metadata: {},
});

export default function ResourceLibrary({ protocol, onChange, onClose }) {
  const locked = protocol.status === 'frozen', resources = protocol.stimuli || [];
  const protoRef = useRef(protocol);
  useEffect(() => { protoRef.current = protocol; }, [protocol]);
  const cloneLatest = () => structuredClone(protoRef.current);
  const [confirmState, setConfirm] = useState(null);
  const change = next => onChange({ ...cloneLatest(), stimuli: next, updated_at: new Date().toISOString() });
  const update = (id, values) => change(resources.map(r => r.stimulus_id === id ? { ...r, ...values } : r));

  const remove = id => {
    const target = resources.find(r => r.stimulus_id === id);
    if (!target) return;
    setConfirm({
      title: 'Delete stimulus?',
      message: `Delete stimulus "${target.name}"? Any nodes referencing it will need new media sources.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => { change(resources.filter(r => r.stimulus_id !== id)); setConfirm(null); },
      onCancel: () => setConfirm(null),
    });
  };

  const upload = async (id, file) => { if (file) update(id, { source_mode: 'upload', ...(await saveAsset(file)) }); };

  return <>
    <div className="resource-library-backdrop"><section className="resource-library">
      <header><div><span>STIMULUS LIBRARY</span><h2>Reusable media resources</h2></div><button onClick={onClose}>Close</button></header>
      <p>Store a media URL or local upload once, then select it from any matching media node. SHA-256 checksums are saved for uploaded files.</p>
      <div className="resource-list">
        {resources.map(r => <article key={r.stimulus_id}>
          <div className="resource-head">
            <input value={r.name || ''} disabled={locked} onChange={e => update(r.stimulus_id, { name: e.target.value })} />
            <select value={r.type || 'video'} disabled={locked} onChange={e => update(r.stimulus_id, { type: e.target.value })}><option value="video">Video</option><option value="audio">Audio</option><option value="image">Image</option></select>
            <button className="danger" disabled={locked} onClick={() => remove(r.stimulus_id)}>Delete</button>
          </div>
          <code>{r.stimulus_id}</code>
          <div className="resource-source">
            <select value={r.source_mode || 'url'} disabled={locked} onChange={e => update(r.stimulus_id, { source_mode: e.target.value })}><option value="url">Direct URL</option>{r.type === 'video' && <option value="youtube">YouTube embed</option>}<option value="upload">Local upload</option></select>
            {r.source_mode === 'upload' ? <label className="file-picker">{r.file_name || 'Choose media file'}<input hidden type="file" disabled={locked} accept={`${r.type}/*`} onChange={e => upload(r.stimulus_id, e.target.files?.[0])} /></label> : <input type="url" disabled={locked} value={r.source_url || ''} placeholder="https://…" onChange={e => update(r.stimulus_id, { source_url: e.target.value })} />}
          </div>
          {r.checksum && <small>SHA-256 {r.checksum}</small>}
        </article>)}
        {!resources.length && <div className="empty">No shared stimuli yet. Direct node resources still remain available.</div>}
      </div>
      <button className="primary" disabled={locked} onClick={() => change([...resources, createResource()])}>＋ Add stimulus</button>
    </section></div>
    {confirmState && <ConfirmDialog {...confirmState} />}
  </>;
}
