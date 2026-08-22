import { PROTOCOL_GRAPH_SCHEMA_VERSION } from './protocolGraph.js';
import { validateDeviceConnector } from '../devices/deviceConnector.js';

const VARIABLE_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'object', 'array', 'unknown']);
const VARIABLE_SCOPES = new Set(['project', 'session', 'container', 'trial', 'component']);

function issue(code, message, path, details = {}) {
  return { code, message, path, ...details };
}

function walkUi(element, visit) {
  if (!element) return;
  visit(element);
  (element.children || []).forEach(child => walkUi(child, visit));
}

export function validateProtocolGraph(protocol, registry) {
  const errors = [];
  const warnings = [];
  if (!protocol || typeof protocol !== 'object') {
    return { valid: false, errors: [issue('protocol.invalid', 'Protocol must be an object', '')], warnings };
  }
  if (protocol.schemaVersion !== PROTOCOL_GRAPH_SCHEMA_VERSION) {
    errors.push(issue('schema.unsupported', `Unsupported schema version ${protocol.schemaVersion || '(missing)'}`, 'schemaVersion'));
  }
  if (!protocol.protocolId) errors.push(issue('protocol.id_missing', 'Protocol ID is required', 'protocolId'));
  if (!protocol.metadata?.name?.trim()) errors.push(issue('protocol.name_missing', 'Protocol name is required', 'metadata.name'));

  const nodes = Array.isArray(protocol.graph?.nodes) ? protocol.graph.nodes : [];
  const edges = Array.isArray(protocol.graph?.edges) ? protocol.graph.edges : [];
  if (!nodes.length) errors.push(issue('graph.empty', 'Protocol graph needs nodes', 'graph.nodes'));

  const nodeById = new Map();
  for (const [index, node] of nodes.entries()) {
    const path = `graph.nodes.${index}`;
    if (!node?.id) errors.push(issue('node.id_missing', 'Node ID is required', `${path}.id`));
    else if (nodeById.has(node.id)) errors.push(issue('node.id_duplicate', `Duplicate node ID ${node.id}`, `${path}.id`, { nodeId: node.id }));
    else nodeById.set(node.id, node);
    if (!node?.component?.type || !node?.component?.version) {
      errors.push(issue('node.component_missing', 'Node component type and version are required', `${path}.component`, { nodeId: node?.id }));
    } else if (!registry?.has(node.component.type, node.component.version)) {
      errors.push(issue('node.component_unknown', `Unknown component ${node.component.type}@${node.component.version}`, `${path}.component`, { nodeId: node.id }));
    }
  }

  if (!protocol.graph?.entryNodeId || !nodeById.has(protocol.graph.entryNodeId)) {
    errors.push(issue('graph.entry_missing', 'Graph entry node is missing or invalid', 'graph.entryNodeId'));
  } else if (nodeById.get(protocol.graph.entryNodeId)?.component?.type !== 'core.start') {
    errors.push(issue('graph.entry_not_start', 'Graph entry node must be a core.start component', 'graph.entryNodeId'));
  }

  const starts = nodes.filter(node => node.component?.type === 'core.start');
  const ends = nodes.filter(node => node.component?.type === 'core.end');
  if (starts.length !== 1) errors.push(issue('graph.start_count', `Graph needs exactly one Start node; found ${starts.length}`, 'graph.nodes'));
  if (!ends.length) errors.push(issue('graph.end_missing', 'Graph needs at least one End node', 'graph.nodes'));

  for (const [packageIndex, componentPackage] of (protocol.componentPackages || []).entries()) {
    const approved = new Set(componentPackage.approvedPermissions || []);
    for (const permission of componentPackage.permissions || []) {
      if (!approved.has(permission)) errors.push(issue('sdk.permission_unapproved', `Package ${componentPackage.packageId} lacks approval for ${permission}`, `componentPackages.${packageIndex}.approvedPermissions`));
    }
    const componentKeys = new Set((componentPackage.components || []).map(component => `${component.type}@${component.version}`));
    nodes.filter(node => componentKeys.has(`${node.component?.type}@${node.component?.version}`)).forEach(node => {
      walkUi(node.config?.ui?.root, element => {
        const variableBinding = Object.values(element.bindings || {}).some(binding => typeof binding === 'string' && binding.startsWith('variables.'));
        if (variableBinding && !approved.has('session.variables.read')) errors.push(issue('sdk.permission_variable_read', `${node.label} reads variables without package permission`, `graph.nodes.${node.id}.config.ui`, { nodeId: node.id }));
        if (element.type === 'Media' && element.props?.sourceUrl && !approved.has('network.media')) errors.push(issue('sdk.permission_network_media', `${node.label} uses network media without package permission`, `graph.nodes.${node.id}.config.ui`, { nodeId: node.id }));
        if (element.type === 'Media' && element.props?.assetId && !approved.has('assets.read')) errors.push(issue('sdk.permission_asset_read', `${node.label} reads an asset without package permission`, `graph.nodes.${node.id}.config.ui`, { nodeId: node.id }));
      });
    });
  }

  const connectorKeys = new Set();
  for (const [connectorIndex, connector] of (protocol.deviceConnectors || []).entries()) {
    const path = `deviceConnectors.${connectorIndex}`;
    const check = validateDeviceConnector(connector);
    check.errors.forEach(error => errors.push(issue('device.connector_invalid', `${connector.connectorId || 'Device connector'}: ${error}`, path)));
    const key = `${connector.connectorId}@${connector.version}`;
    if (connectorKeys.has(key)) errors.push(issue('device.connector_duplicate', `Duplicate device connector ${key}`, path));
    else connectorKeys.add(key);
    const approved = new Set(connector.approvedPermissions || []);
    for (const permission of connector.permissions || []) {
      if (!approved.has(permission)) errors.push(issue('device.permission_unapproved', `Connector ${connector.connectorId} lacks approval for ${permission}`, `${path}.approvedPermissions`));
    }
  }
  for (const node of nodes.filter(item => item.config?.deviceConnectorId)) {
    const connector = (protocol.deviceConnectors || []).find(item => item.connectorId === node.config.deviceConnectorId && (!node.config.deviceConnectorVersion || item.version === node.config.deviceConnectorVersion));
    if (!connector) errors.push(issue('device.connector_missing', `${node.label} references unavailable connector ${node.config.deviceConnectorId}`, `graph.nodes.${node.id}.config.deviceConnectorId`, { nodeId: node.id }));
  }

  const edgeIds = new Set();
  const incomingPortCounts = new Map();
  for (const [index, edge] of edges.entries()) {
    const path = `graph.edges.${index}`;
    if (!edge?.id) errors.push(issue('edge.id_missing', 'Edge ID is required', `${path}.id`));
    else if (edgeIds.has(edge.id)) errors.push(issue('edge.id_duplicate', `Duplicate edge ID ${edge.id}`, `${path}.id`, { edgeId: edge.id }));
    else edgeIds.add(edge.id);
    if (!['control', 'data'].includes(edge?.kind)) errors.push(issue('edge.kind_invalid', `Invalid edge kind ${edge?.kind}`, `${path}.kind`, { edgeId: edge?.id }));

    const sourceNode = nodeById.get(edge?.source?.nodeId);
    const targetNode = nodeById.get(edge?.target?.nodeId);
    if (!sourceNode) errors.push(issue('edge.source_missing', `Edge source node ${edge?.source?.nodeId || '(missing)'} does not exist`, `${path}.source`, { edgeId: edge?.id }));
    if (!targetNode) errors.push(issue('edge.target_missing', `Edge target node ${edge?.target?.nodeId || '(missing)'} does not exist`, `${path}.target`, { edgeId: edge?.id }));
    if (!sourceNode || !targetNode || !registry) continue;

    const sourceDefinition = registry.get(sourceNode.component.type, sourceNode.component.version);
    const targetDefinition = registry.get(targetNode.component.type, targetNode.component.version);
    const sourcePort = sourceDefinition?.ports.find(port => port.id === edge.source.portId);
    const targetPort = targetDefinition?.ports.find(port => port.id === edge.target.portId);
    if (!sourcePort) errors.push(issue('edge.source_port_missing', `Source port ${edge.source.portId} does not exist`, `${path}.source.portId`, { edgeId: edge.id }));
    if (!targetPort) errors.push(issue('edge.target_port_missing', `Target port ${edge.target.portId} does not exist`, `${path}.target.portId`, { edgeId: edge.id }));
    if (!sourcePort || !targetPort) continue;
    if (sourcePort.direction !== 'output') errors.push(issue('edge.source_direction', 'Edge source must be an output port', `${path}.source`, { edgeId: edge.id }));
    if (targetPort.direction !== 'input') errors.push(issue('edge.target_direction', 'Edge target must be an input port', `${path}.target`, { edgeId: edge.id }));
    if (sourcePort.kind !== edge.kind || targetPort.kind !== edge.kind) errors.push(issue('edge.kind_mismatch', 'Edge kind must match both ports', path, { edgeId: edge.id }));
    if (edge.kind === 'data' && sourcePort.dataType !== 'unknown' && targetPort.dataType !== 'unknown' && sourcePort.dataType !== targetPort.dataType) {
      errors.push(issue('edge.data_type_mismatch', `Cannot connect ${sourcePort.dataType} to ${targetPort.dataType}`, path, { edgeId: edge.id }));
    }
    const targetKey = `${edge.target.nodeId}:${edge.target.portId}`;
    incomingPortCounts.set(targetKey, (incomingPortCounts.get(targetKey) || 0) + 1);
    if (!targetPort.multiple && incomingPortCounts.get(targetKey) > 1) {
      errors.push(issue('edge.target_multiple', `Port ${edge.target.portId} accepts only one connection`, `${path}.target`, { edgeId: edge.id }));
    }
  }

  const groupIds = new Set();
  const groupedNodes = new Map();
  for (const [index, group] of (protocol.graph?.groups || []).entries()) {
    const path = `graph.groups.${index}`;
    if (!group?.id) errors.push(issue('group.id_missing', 'Group ID is required', `${path}.id`));
    else if (groupIds.has(group.id)) errors.push(issue('group.id_duplicate', `Duplicate group ID ${group.id}`, `${path}.id`));
    else groupIds.add(group.id);
    if (!group?.name?.trim()) errors.push(issue('group.name_missing', 'Group name is required', `${path}.name`));
    if (!(group?.nodeIds || []).length) warnings.push(issue('group.empty', `Group ${group?.name || group?.id || index} is empty`, `${path}.nodeIds`));
    for (const nodeId of group?.nodeIds || []) {
      if (!nodeById.has(nodeId)) errors.push(issue('group.node_missing', `Group references unknown node ${nodeId}`, `${path}.nodeIds`));
      if (groupedNodes.has(nodeId)) errors.push(issue('group.node_multiple', `Node ${nodeId} belongs to multiple groups`, `${path}.nodeIds`, { nodeId }));
      else groupedNodes.set(nodeId, group.id);
    }
    if (!['container', 'subflow'].includes(group?.kind || 'container')) errors.push(issue('group.kind_invalid', `Group ${group?.name || group?.id} has an invalid kind`, `${path}.kind`));
    if (group?.kind === 'subflow') {
      if (!group.entryNodeId || !group.nodeIds?.includes(group.entryNodeId)) errors.push(issue('subflow.entry_invalid', `Subflow ${group.name} needs one entry node from its members`, `${path}.entryNodeId`));
      if (!(group.exitNodeIds || []).length || group.exitNodeIds.some(nodeId => !group.nodeIds?.includes(nodeId))) errors.push(issue('subflow.exit_invalid', `Subflow ${group.name} needs at least one member exit node`, `${path}.exitNodeIds`));
      const parameterNames = new Set();
      for (const [parameterIndex, parameter] of (group.parameters || []).entries()) {
        const parameterPath = `${path}.parameters.${parameterIndex}`;
        if (!parameter?.name?.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) errors.push(issue('subflow.parameter_name_invalid', 'Subflow parameter needs a valid name', `${parameterPath}.name`));
        else if (parameterNames.has(parameter.name)) errors.push(issue('subflow.parameter_name_duplicate', `Duplicate subflow parameter ${parameter.name}`, `${parameterPath}.name`));
        else parameterNames.add(parameter.name);
        if (!VARIABLE_TYPES.has(parameter?.type)) errors.push(issue('subflow.parameter_type_invalid', `Invalid subflow parameter type ${parameter?.type}`, `${parameterPath}.type`));
        if (!['input', 'output'].includes(parameter?.direction)) errors.push(issue('subflow.parameter_direction_invalid', `Invalid subflow parameter direction ${parameter?.direction}`, `${parameterPath}.direction`));
        const endpointName = parameter?.direction === 'output' ? 'source' : 'target';
        const endpoint = parameter?.[endpointName];
        if (!endpoint?.nodeId || !endpoint?.portId || !group.nodeIds?.includes(endpoint.nodeId)) {
          errors.push(issue('subflow.parameter_endpoint_invalid', `Subflow parameter ${parameter?.name || parameterIndex + 1} needs a member ${endpointName} endpoint`, `${parameterPath}.${endpointName}`));
        } else {
          const endpointNode = nodeById.get(endpoint.nodeId);
          const port = registry?.get(endpointNode?.component?.type, endpointNode?.component?.version)?.ports.find(item => item.id === endpoint.portId);
          if (!port || port.kind !== 'data' || port.direction !== parameter.direction) errors.push(issue('subflow.parameter_port_invalid', `Subflow parameter ${parameter.name} must use a ${parameter.direction} data port`, `${parameterPath}.${endpointName}`));
          else if (parameter.type !== 'unknown' && port.dataType !== 'unknown' && parameter.type !== port.dataType) errors.push(issue('subflow.parameter_port_type_mismatch', `Subflow parameter ${parameter.name} (${parameter.type}) does not match ${endpoint.portId} (${port.dataType})`, `${parameterPath}.type`));
        }
      }
    }
  }

  const subflowMappedInputs = new Set((protocol.graph?.groups || []).flatMap(group => (group.parameters || [])
    .filter(parameter => parameter.direction === 'input' && group.parameterMappings?.[parameter.name] && parameter.target?.nodeId && parameter.target?.portId)
    .map(parameter => `${parameter.target.nodeId}:${parameter.target.portId}`)));

  for (const node of nodes) {
    const definition = registry?.get(node.component?.type, node.component?.version);
    if (!definition) continue;
    for (const port of definition.ports.filter(port => port.direction === 'input' && port.required)) {
      const connected = edges.some(edge => edge.target?.nodeId === node.id && edge.target?.portId === port.id);
      const bound = Object.prototype.hasOwnProperty.call(node.bindings || {}, port.id) || subflowMappedInputs.has(`${node.id}:${port.id}`);
      if (!connected && !bound) errors.push(issue('port.required_unbound', `Required port ${port.id} is not connected or bound`, `graph.nodes.${node.id}.bindings.${port.id}`, { nodeId: node.id }));
    }
    for (const port of definition.ports.filter(port => port.direction === 'output' && port.kind === 'control' && port.required)) {
      const connected = edges.some(edge => edge.source?.nodeId === node.id && edge.source?.portId === port.id);
      if (!connected) errors.push(issue('port.required_unconnected', `Required output ${port.id} is not connected`, `graph.nodes.${node.id}.ports.${port.id}`, { nodeId: node.id }));
    }
  }

  const variableNames = new Set();
  const variableByName = new Map();
  for (const [index, variable] of (protocol.variables || []).entries()) {
    const path = `variables.${index}`;
    if (!variable?.name?.trim()) errors.push(issue('variable.name_missing', 'Variable name is required', `${path}.name`));
    else if (variableNames.has(variable.name)) errors.push(issue('variable.name_duplicate', `Duplicate variable ${variable.name}`, `${path}.name`));
    else { variableNames.add(variable.name); variableByName.set(variable.name, variable); }
    if (!VARIABLE_TYPES.has(variable?.type)) errors.push(issue('variable.type_invalid', `Invalid variable type ${variable?.type}`, `${path}.type`));
    if (!VARIABLE_SCOPES.has(variable?.scope)) errors.push(issue('variable.scope_invalid', `Invalid variable scope ${variable?.scope}`, `${path}.scope`));
  }

  for (const [groupIndex, group] of (protocol.graph?.groups || []).entries()) {
    if (group.kind !== 'subflow' || !group.metadata?.templateId) continue;
    const parameterNames = new Set((group.parameters || []).map(parameter => parameter.name));
    for (const parameter of group.parameters || []) {
      const variableName = group.parameterMappings?.[parameter.name];
      const variable = variableByName.get(variableName);
      const path = `graph.groups.${groupIndex}.parameterMappings.${parameter.name}`;
      if (!variableName || !variable) errors.push(issue('subflow.parameter_mapping_missing', `Subflow parameter ${parameter.name} needs a declared variable mapping`, path));
      else if (parameter.type !== 'unknown' && variable.type !== 'unknown' && parameter.type !== variable.type) errors.push(issue('subflow.parameter_mapping_type_mismatch', `Subflow parameter ${parameter.name} (${parameter.type}) cannot map to ${variable.name} (${variable.type})`, path));
    }
    for (const name of Object.keys(group.parameterMappings || {})) {
      if (!parameterNames.has(name)) warnings.push(issue('subflow.parameter_mapping_unused', `Subflow mapping ${name} has no parameter`, `graph.groups.${groupIndex}.parameterMappings.${name}`));
    }
  }

  const templateIds = new Set();
  for (const [templateIndex, template] of (protocol.subflowTemplates || []).entries()) {
    const path = `subflowTemplates.${templateIndex}`;
    if (!template?.id || templateIds.has(template.id)) errors.push(issue('subflow.template_id_invalid', 'Subflow template IDs must be present and unique', `${path}.id`));
    else templateIds.add(template.id);
    const templateNodeById = new Map((template.nodes || []).map(node => [node.id, node]));
    const templateNodes = new Set(templateNodeById.keys());
    if (!templateNodes.size) errors.push(issue('subflow.template_empty', `Subflow template ${template?.name || template?.id} has no nodes`, `${path}.nodes`));
    if (!templateNodes.has(template?.entryNodeId)) errors.push(issue('subflow.template_entry_invalid', `Subflow template ${template?.name || template?.id} has an invalid entry`, `${path}.entryNodeId`));
    if (!(template?.exitNodeIds || []).length || template.exitNodeIds.some(nodeId => !templateNodes.has(nodeId))) errors.push(issue('subflow.template_exit_invalid', `Subflow template ${template?.name || template?.id} has invalid exits`, `${path}.exitNodeIds`));
    for (const edge of template?.edges || []) {
      if (!templateNodes.has(edge.source?.nodeId) || !templateNodes.has(edge.target?.nodeId)) errors.push(issue('subflow.template_edge_invalid', `Subflow template ${template?.name || template?.id} has an external edge`, `${path}.edges`));
    }
    const parameterNames = new Set();
    for (const [parameterIndex, parameter] of (template?.parameters || []).entries()) {
      const parameterPath = `${path}.parameters.${parameterIndex}`;
      if (!parameter?.name?.match(/^[A-Za-z_][A-Za-z0-9_]*$/) || parameterNames.has(parameter.name)) errors.push(issue('subflow.template_parameter_name_invalid', 'Template parameter names must be valid and unique', `${parameterPath}.name`));
      else parameterNames.add(parameter.name);
      if (!VARIABLE_TYPES.has(parameter?.type) || !['input', 'output'].includes(parameter?.direction)) errors.push(issue('subflow.template_parameter_contract_invalid', `Template parameter ${parameter?.name || parameterIndex + 1} has an invalid contract`, parameterPath));
      const endpointName = parameter?.direction === 'output' ? 'source' : 'target';
      const endpoint = parameter?.[endpointName];
      const endpointNode = templateNodeById.get(endpoint?.nodeId);
      const port = endpointNode && registry?.get(endpointNode.component?.type, endpointNode.component?.version)?.ports.find(item => item.id === endpoint?.portId);
      if (!endpointNode || !port || port.kind !== 'data' || port.direction !== parameter.direction) errors.push(issue('subflow.template_parameter_endpoint_invalid', `Template parameter ${parameter?.name || parameterIndex + 1} has an invalid ${endpointName}`, `${parameterPath}.${endpointName}`));
    }
  }

  for (const node of nodes) {
    const definition = registry?.get(node.component?.type, node.component?.version);
    for (const [portId, binding] of Object.entries(node.bindings || {})) {
      if (binding?.kind !== 'variable') continue;
      const variable = variableByName.get(binding.variable);
      if (!variable) {
        errors.push(issue('binding.variable_missing', `Binding references undeclared variable ${binding.variable || '(missing)'}`, `graph.nodes.${node.id}.bindings.${portId}`, { nodeId: node.id }));
        continue;
      }
      const port = definition?.ports.find(item => item.id === portId && item.kind === 'data' && item.direction === 'input');
      if (port && port.dataType !== 'unknown' && variable.type !== 'unknown' && port.dataType !== variable.type) {
        errors.push(issue('binding.variable_type_mismatch', `Variable ${variable.name} (${variable.type}) cannot bind to ${portId} (${port.dataType})`, `graph.nodes.${node.id}.bindings.${portId}`, { nodeId: node.id }));
      }
    }
  }

  if (protocol.graph?.entryNodeId && nodeById.has(protocol.graph.entryNodeId)) {
    const reachable = new Set();
    const queue = [protocol.graph.entryNodeId];
    while (queue.length) {
      const nodeId = queue.shift();
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      edges.filter(edge => edge.kind === 'control' && edge.source?.nodeId === nodeId).forEach(edge => queue.push(edge.target.nodeId));
    }
    for (const node of nodes) {
      if (!reachable.has(node.id)) warnings.push(issue('node.unreachable', `Node ${node.label || node.id} is not reachable from Start`, `graph.nodes.${node.id}`, { nodeId: node.id }));
    }
    if (!ends.some(node => reachable.has(node.id))) errors.push(issue('graph.end_unreachable', 'No End node is reachable from Start', 'graph'));
  }

  return { valid: errors.length === 0, errors, warnings };
}
