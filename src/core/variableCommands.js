const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VARIABLE_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'object', 'array', 'unknown']);
const VARIABLE_SCOPES = new Set(['project', 'session', 'container', 'trial', 'component']);

function touch(protocol, now = new Date().toISOString()) {
  protocol.audit = { ...(protocol.audit || {}), updatedAt: now };
  return protocol;
}

function normalizeVariable(variable) {
  const next = {
    name: String(variable?.name || '').trim(),
    type: variable?.type || 'unknown',
    scope: variable?.scope || 'session',
    source: variable?.source || 'manual',
    defaultValue: structuredClone(variable?.defaultValue ?? null),
    exportPolicy: variable?.exportPolicy || 'include',
  };
  if (!VARIABLE_NAME.test(next.name)) throw new Error('Variable names must start with a letter or underscore and contain only letters, numbers, and underscores');
  if (!VARIABLE_TYPES.has(next.type)) throw new Error(`Unsupported variable type ${next.type}`);
  if (!VARIABLE_SCOPES.has(next.scope)) throw new Error(`Unsupported variable scope ${next.scope}`);
  return next;
}

function replaceUiVariableBinding(element, oldName, newName) {
  if (!element) return;
  element.bindings = Object.fromEntries(Object.entries(element.bindings || {}).map(([key, value]) => [key, value === `variables.${oldName}` ? `variables.${newName}` : value]));
  for (const child of element.children || []) replaceUiVariableBinding(child, oldName, newName);
}

export function addVariable(protocol, variable, options = {}) {
  const next = structuredClone(protocol);
  const normalized = normalizeVariable(variable);
  if ((next.variables || []).some(item => item.name === normalized.name)) throw new Error(`Variable ${normalized.name} already exists`);
  next.variables = [...(next.variables || []), normalized];
  return touch(next, options.now);
}

export function updateVariable(protocol, name, changes, options = {}) {
  const next = structuredClone(protocol);
  const index = (next.variables || []).findIndex(variable => variable.name === name);
  if (index < 0) throw new Error(`Variable ${name} does not exist`);
  const updated = normalizeVariable({ ...next.variables[index], ...structuredClone(changes || {}) });
  if (updated.name !== name && next.variables.some((variable, variableIndex) => variableIndex !== index && variable.name === updated.name)) throw new Error(`Variable ${updated.name} already exists`);
  next.variables[index] = updated;
  if (updated.name !== name) {
    for (const node of next.graph?.nodes || []) {
      for (const binding of Object.values(node.bindings || {})) {
        if (binding?.kind === 'variable' && binding.variable === name) binding.variable = updated.name;
      }
      replaceUiVariableBinding(node.config?.ui?.root, name, updated.name);
    }
  }
  return touch(next, options.now);
}

export function variableReferences(protocol, name) {
  const references = [];
  for (const node of protocol.graph?.nodes || []) {
    for (const [portId, binding] of Object.entries(node.bindings || {})) {
      if (binding?.kind === 'variable' && binding.variable === name) references.push({ kind: 'node-binding', nodeId: node.id, portId });
    }
    const visit = element => {
      if (!element) return;
      for (const [property, binding] of Object.entries(element.bindings || {})) {
        if (binding === `variables.${name}`) references.push({ kind: 'ui-binding', nodeId: node.id, elementId: element.id, property });
      }
      for (const child of element.children || []) visit(child);
    };
    visit(node.config?.ui?.root);
  }
  return references;
}

export function removeVariable(protocol, name, options = {}) {
  const references = variableReferences(protocol, name);
  if (references.length && !options.force) throw new Error(`Variable ${name} is still used by ${references.length} binding(s)`);
  const next = structuredClone(protocol);
  const before = (next.variables || []).length;
  next.variables = (next.variables || []).filter(variable => variable.name !== name);
  if (next.variables.length === before) return protocol;
  if (options.force) {
    for (const node of next.graph?.nodes || []) {
      node.bindings = Object.fromEntries(Object.entries(node.bindings || {}).filter(([, binding]) => !(binding?.kind === 'variable' && binding.variable === name)));
    }
  }
  return touch(next, options.now);
}
