import {
  AssetLibrary,
  CollaborationCatalog,
  ComponentPackageCatalog,
  DeploymentCatalog,
  DeviceConnectorCatalog,
  GroupCatalog,
  SubflowTemplateCatalog,
  VariableCatalog,
  VisualAngleCalculator,
} from './Catalogs.jsx';

export default function Palette({ s, onHostedRun }) {
  const {
    t, locked, editorMode, paletteGroups, addComponent, actions,
    protocol, registry, collaborationBaseline, setMessage,
  } = s;
  return <aside className="composer-palette">
    <h2>{t('Components')}</h2>
    <p>{t('Click to insert into the selected flow.')}</p>
    {paletteGroups.map(([category, definitions]) => <section key={category}>
      <h3>{category}</h3>
      {definitions.map(definition => <button key={definition.type} draggable={!locked} title="Drag onto the canvas" onClick={() => addComponent(definition)} onDragStart={event => { event.dataTransfer.setData('application/x-physioflow-node', definition.type); event.dataTransfer.effectAllowed = 'copy'; }}><b>{definition.label}</b><small>{definition.type}</small></button>)}
    </section>)}
    {editorMode !== 'quick' && <AssetLibrary assets={protocol.assets || []} locked={locked} onUpdate={actions.updateAssets} />}
    {editorMode !== 'quick' && <VisualAngleCalculator />}
    {editorMode !== 'quick' && <VariableCatalog mode={editorMode} variables={protocol.variables || []} locked={locked} onError={error => setMessage(error.message || String(error))} onAdd={actions.addVariable} onUpdate={actions.updateVariable} onRemove={actions.removeVariable} />}
    {editorMode !== 'quick' && <GroupCatalog registry={registry} groups={protocol.graph.groups || []} nodes={protocol.graph.nodes} locked={locked} onUpdate={actions.updateGroup} onRemove={actions.removeGroup} onPublish={actions.publishGroup} />}
    {editorMode === 'advanced' && <ComponentPackageCatalog packages={protocol.componentPackages || []} locked={locked} onInstallExample={actions.installExamplePackage} onImport={actions.importPackage} onRemove={actions.removePackage} />}
    {editorMode === 'advanced' && <DeviceConnectorCatalog connectors={protocol.deviceConnectors || []} locked={locked} onInstallExample={actions.installExampleConnector} onImport={actions.importConnector} onRemove={actions.removeConnector} />}
    {editorMode === 'advanced' && <CollaborationCatalog protocol={protocol} baseline={collaborationBaseline} locked={locked} onSetBaseline={actions.setBaseline} onApply={actions.applyChangeSet} onMessage={setMessage} />}
    {editorMode === 'advanced' && <DeploymentCatalog protocol={protocol} onHostedRun={onHostedRun} onMessage={setMessage} />}
    {editorMode !== 'quick' && <SubflowTemplateCatalog templates={protocol.subflowTemplates || []} variables={protocol.variables || []} locked={locked} onInstantiate={actions.instantiateSubflow} onRemove={actions.removeSubflowTemplate} />}
  </aside>;
}
