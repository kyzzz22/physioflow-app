import {
  addVariable,
  assignNodeToGroup,
  createNodeGroup,
  createSubflowTemplate,
  instantiateSubflowTemplate,
  removeNodeGroup,
  removeSubflowTemplate,
  removeVariable,
  updateNode,
  updateNodeGroup,
  updateVariable,
} from '../core/index.js';
import { exampleReactionButtonPackage, installComponentPackage, uninstallComponentPackage } from '../sdk/index.js';
import { exampleSimulatedConnector, installDeviceConnector, uninstallDeviceConnector } from '../devices/index.js';
import { configFromParticipantUi } from '../runtime/index.js';

// Catalog / inspector callbacks, pre-wired to commit so the view components
// stay presentational. Kept adjacent to the state they mutate.
export function useCatalogActions({ protocol, commit, setMessage, setSelectedNodeId, selectedNode, previewNode, setCollaborationBaseline }) {
  const updatePreviewUi = ui => { if (previewNode) commit(updateNode(protocol, previewNode.id, { config: configFromParticipantUi(previewNode, ui) })); };
  return {
    updatePreviewUi,
    markMigrationReviewed: () => commit({ ...protocol, legacy: { ...protocol.legacy, migrationReport: { ...protocol.legacy.migrationReport, formalRunAllowed: true, reviewedAt: new Date().toISOString() } } }),
    addVariable: variable => commit(addVariable(protocol, variable)),
    updateVariable: (name, changes) => commit(updateVariable(protocol, name, changes)),
    removeVariable: name => { try { commit(removeVariable(protocol, name)); } catch (error) { setMessage(error.message); } },
    updateGroup: (groupId, changes) => commit(updateNodeGroup(protocol, groupId, changes)),
    removeGroup: groupId => commit(removeNodeGroup(protocol, groupId)),
    publishGroup: groupId => { try { const result = createSubflowTemplate(protocol, groupId); commit(result.protocol); setMessage(`Published reusable subflow ${result.template.name}`); } catch (error) { setMessage(error.message); } },
    installExamplePackage: () => { try { commit(installComponentPackage(protocol, exampleReactionButtonPackage(), { approvedPermissions: ['events.emit'] })); setMessage('Installed Reaction Button example package'); } catch (error) { setMessage(error.message); } },
    importPackage: componentPackage => { try { commit(installComponentPackage(protocol, componentPackage, { approvedPermissions: componentPackage.permissions || [] })); setMessage(`Installed ${componentPackage.name}`); } catch (error) { setMessage(error.message); } },
    removePackage: (packageId, version) => { try { commit(uninstallComponentPackage(protocol, packageId, version)); } catch (error) { setMessage(error.message); } },
    installExampleConnector: () => { try { const connector = exampleSimulatedConnector(); commit(installDeviceConnector(protocol, connector, { approvedPermissions: connector.permissions })); setMessage('Installed simulated physiology connector'); } catch (error) { setMessage(error.message); } },
    importConnector: connector => { try { commit(installDeviceConnector(protocol, connector, { approvedPermissions: connector.permissions || [] })); setMessage(`Installed ${connector.name}`); } catch (error) { setMessage(error.message); } },
    removeConnector: (connectorId, version) => { try { commit(uninstallDeviceConnector(protocol, connectorId, version)); } catch (error) { setMessage(error.message); } },
    setBaseline: () => { setCollaborationBaseline(structuredClone(protocol)); setMessage('Collaboration baseline updated'); },
    applyChangeSet: next => { commit(next); setCollaborationBaseline(structuredClone(next)); setMessage('Collaboration change set applied'); },
    instantiateSubflow: (templateId, parameterMappings) => { try { const result = instantiateSubflowTemplate(protocol, templateId, { parameterMappings, position: { x: 320, y: 180 + (protocol.graph.groups?.length || 0) * 170 } }); commit(result.protocol); setSelectedNodeId(result.group.entryNodeId); setMessage(`Created ${result.group.name}`); } catch (error) { setMessage(error.message); } },
    removeSubflowTemplate: templateId => { try { commit(removeSubflowTemplate(protocol, templateId)); } catch (error) { setMessage(error.message); } },
    assignNodeToGroup: groupId => commit(assignNodeToGroup(protocol, selectedNode.id, groupId)),
    createGroupFromSelection: () => { try { const result = createNodeGroup(protocol, [selectedNode.id], { name: `${selectedNode.label} group` }); commit(result.protocol); setMessage(`Created group ${result.group.name}`); } catch (error) { setMessage(error.message); } },
    updateAssets: assets => commit({ ...protocol, assets }),
    updateStimulusPools: stimulusPools => commit({ ...protocol, stimulusPools }),
    updateLibrary: library => commit({ ...protocol, questionnaireLibrary: library }),
  };
}
