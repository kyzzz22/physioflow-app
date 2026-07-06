// MediaSettings.jsx — Shared media configuration UI (used in Inspector + Builder text editor)
import { useState } from 'react';
import { saveAsset } from './assetStore.js';
import MediaStep from './MediaStep.jsx';
import { MEDIA_TYPES } from './constants.js';

export default function MediaSettings({ item, disabled, updateStep, stimuli }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const s = item; // alias for conciseness

  // Resolve which media tab to show based on step type
  if (!s || !MEDIA_TYPES.includes(s.type)) return null;

  const compatible = (stimuli || []).filter(r => r.type === s.type);
  const resolvedUrl = s.source_url || '';
  const hasSource = resolvedUrl || s.asset_id;

  return (
    <fieldset className="inspector-fieldset">
      <legend>Media settings</legend>

      {compatible.length > 0 && (
        <label>Reusable resource
          <select value={s.stimulus_id || ''} disabled={disabled} onChange={e => updateStep({ stimulus_id: e.target.value })}>
            <option value="">None — use settings below</option>
            {compatible.map(r => <option value={r.stimulus_id} key={r.stimulus_id}>{r.name}</option>)}
          </select>
          {s.stimulus_id && <small>Using shared resource; local settings below act as overrides.</small>}
        </label>
      )}

      <label>Source
        <select value={s.source_mode || 'url'} disabled={disabled} onChange={e => updateStep({ source_mode: e.target.value })}>
          <option value="url">Direct URL</option>
          {s.type === 'video' && <option value="youtube">YouTube embed</option>}
          <option value="upload">Upload file</option>
        </select>
      </label>

      {s.source_mode === 'upload' ? (
        <label className="inspector-upload">
          <input type="file" disabled={disabled} accept={s.type === 'audio' ? 'audio/*' : s.type === 'image' ? 'image/*' : 'video/*'}
            onChange={async e => {
              const file = e.target.files?.[0];
              if (file) { try { const data = await saveAsset(file); updateStep(data); } catch (err) { console.warn('Failed to save asset:', err); } }
            }}
          />
          <span>{s.file_name || 'Choose a file'}</span>
          <small>Stored locally with SHA-256 checksum</small>
        </label>
      ) : (
        <label>Resource URL
          <input type="url" value={resolvedUrl} disabled={disabled}
            placeholder={s.source_mode === 'youtube' ? 'https://youtu.be/...' : 'https://...'}
            onChange={e => updateStep({ source_url: e.target.value })} />
        </label>
      )}

      {s.type !== 'image' && (
        <>
          <label>Volume <output>{Math.round((s.volume ?? 1) * 100)}%</output>
            <input type="range" min="0" max="1" step="0.05" value={s.volume ?? 1} disabled={disabled}
              onChange={e => updateStep({ volume: Number(e.target.value) })} />
          </label>
          <div className="check-row-group">
            <label className="check-row"><input type="checkbox" checked={s.show_controls !== false} disabled={disabled}
              onChange={e => updateStep({ show_controls: e.target.checked })} /> Player controls</label>
            <label className="check-row"><input type="checkbox" checked={Boolean(s.muted)} disabled={disabled}
              onChange={e => updateStep({ muted: e.target.checked })} /> Muted</label>
            <label className="check-row"><input type="checkbox" checked={Boolean(s.loop)} disabled={disabled}
              onChange={e => updateStep({ loop: e.target.checked })} /> Loop</label>
          </div>
        </>
      )}

      {hasSource && (
        <div className="media-preview-section">
          <button className="preview-toggle" onClick={() => setPreviewOpen(o => !o)} disabled={disabled}>
            {previewOpen ? '▼ Hide preview' : '▶ Preview media'}
          </button>
          {previewOpen && (
            <div className="media-preview-box">
              {s.type === 'video' && s.source_mode === 'youtube' ? (
                <div className="embed-frame">
                  <iframe src={`https://www.youtube-nocookie.com/embed/${extractYouTubeId(resolvedUrl)}`}
                    allow="encrypted-media" allowFullScreen title="YouTube preview" />
                </div>
              ) : (
                <MediaStep step={{ ...s, source_url: resolvedUrl }} onComplete={() => {}} onMediaEvent={() => {}} preview />
              )}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

function extractYouTubeId(url) {
  const m = url?.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?#]+)/);
  return m?.[1] || '';
}
