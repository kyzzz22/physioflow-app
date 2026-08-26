import { NodeInspector } from './NodeInspector.jsx';
import { validationIssueMessage } from './toolbox.js';

export default function Inspector({ s }) {
  const {
    t, language, locked, editorMode, migrationReviewRequired,
    protocol, registry, selectedNode, selectedEdge,
    validation, showAllValidation, setShowAllValidation,
    dataOutputOptions, updateSelected, deleteSelection, duplicateSelection,
    setSelectedNodeId, actions,
  } = s;
  return <aside className="composer-inspector">
    <h2>{t('Inspector')}</h2>
    {migrationReviewRequired && <div className="migration-review-warning"><b>Migration review required</b><span>{protocol.legacy.migrationReport.issues.length} item(s) must be checked before this draft can be frozen.</span></div>}
    {selectedNode && <NodeInspector node={selectedNode} definition={registry.get(selectedNode.component.type, selectedNode.component.version)} variables={protocol.variables || []} groups={protocol.graph.groups || []} mode={editorMode} onUpdate={updateSelected} onAssignGroup={actions.assignNodeToGroup} questionnaireLibrary={protocol.questionnaireLibrary || []} onLibraryChange={actions.updateLibrary} assets={protocol.assets || []} dataOutputOptions={dataOutputOptions} onCreateGroup={actions.createGroupFromSelection} />}
    {selectedEdge && <div className="inspector-card"><b>{selectedEdge.kind} connection</b><code>{selectedEdge.source.portId} → {selectedEdge.target.portId}</code><button className="danger" onClick={deleteSelection}>Delete connection</button></div>}
    {!selectedNode && !selectedEdge && <p>{t('Select a node or connection to configure it.')}</p>}
    {!locked && selectedNode && !['core.start', 'core.end'].includes(selectedNode.component.type) && <button onClick={duplicateSelection}>Duplicate node</button>}
    {!locked && selectedNode && selectedNode.component.type !== 'core.start' && <button className="danger" onClick={deleteSelection}>Delete node</button>}
    <section className={`composer-validation ${validation.valid ? 'valid' : 'invalid'}`}>
      <h3>{validation.valid ? `✓ ${t('Graph valid')}` : `${validation.errors.length} ${t('blocking issues')}`}</h3>
      {(() => {
        const allIssues = [...validation.errors, ...validation.warnings];
        const visible = showAllValidation ? allIssues : allIssues.slice(0, 8);
        return <>
          {visible.map((issue, index) => <button key={`${issue.code}-${index}`} onClick={() => issue.nodeId && setSelectedNodeId(issue.nodeId)}><b>{issue.code}</b><span>{validationIssueMessage(issue, language, protocol)}</span></button>)}
          {allIssues.length > 8 && <button className="composer-validation-more" onClick={() => setShowAllValidation(show => !show)}>{showAllValidation ? `− ${t('Show fewer')}` : `+ ${t('Show all')} (${allIssues.length})`}</button>}
        </>;
      })()}
    </section>
  </aside>;
}
