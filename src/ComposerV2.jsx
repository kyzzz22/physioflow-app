import ParticipantUiBuilder from './ParticipantUiBuilder.jsx';
import ParticipantRenderer from './ParticipantRenderer.jsx';
import { localResourceManifest, schemaForNode } from './runtime/index.js';
import { UI_TEMPLATE_KIND } from './composer/toolbox.js';
import { CodeView } from './composer/NodeInspector.jsx';
import { useComposerState } from './composer/useComposerState.js';
import Header from './composer/Header.jsx';
import Palette from './composer/Palette.jsx';
import Canvas from './composer/Canvas.jsx';
import Inspector from './composer/Inspector.jsx';

export default function ComposerV2({ protocol, onChange, onSave, onBack, onExport, onPreview, onFreeze, onCreateDraft, onHostedRun, onUndo, onRedo, canUndo, canRedo, hasUnsaved, saveAnim }) {
  const s = useComposerState({ protocol, onChange });
  const {
    locked, codeView, codeText, codeError,
    deletePending, confirmDelete, cancelDelete,
    previewNode, previewDefinition, previewEdit, setPreviewEdit, setPreviewNodeId,
    actions, setCodeText, applyCode,
  } = s;
  return <main className={`composer-v2 ${locked ? 'locked' : ''}`}>
    <Header s={s} onSave={onSave} onBack={onBack} onExport={onExport} onPreview={onPreview} onFreeze={onFreeze} onCreateDraft={onCreateDraft} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} hasUnsaved={hasUnsaved} saveAnim={saveAnim} />
    {deletePending && <div className="composer-delete-confirm">Delete {deletePending.ids.length} node(s)? This cannot be undone.
      <button className="danger" onClick={confirmDelete}>Delete</button>
      <button onClick={cancelDelete}>Cancel</button>
    </div>}
    {codeView ? <CodeView text={codeText} error={codeError} locked={locked} onChange={setCodeText} onApply={applyCode} /> : <div className="composer-layout">
      <Palette s={s} onHostedRun={onHostedRun} />
      <Canvas s={s} />
      <Inspector s={s} />
    </div>}
    {previewNode && <div className="node-editor-fullscreen">
      <div className="node-editor-header">
        <b>{previewNode.label}</b><small>{previewNode.component.type}@{previewNode.component.version}</small>
        <button disabled={locked} onClick={() => setPreviewEdit(value => !value)}>{previewEdit ? 'View' : '✎ Edit'}</button>
        <button className="node-editor-close" onClick={() => setPreviewNodeId(null)}>✕ Done</button>
      </div>
      {previewEdit && previewNode.config?.ui
        ? <ParticipantUiBuilder schema={schemaForNode(previewNode, previewDefinition, localResourceManifest(protocol.assets || []))} defaultTemplate={UI_TEMPLATE_KIND[previewNode.component.type] || 'instruction'} onChange={actions.updatePreviewUi} />
        : <div className="node-editor-preview"><ParticipantRenderer schema={schemaForNode(previewNode, previewDefinition, localResourceManifest(protocol.assets || []))} preview /></div>}
    </div>}
  </main>;
}
