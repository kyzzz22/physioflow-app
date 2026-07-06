export const CONTROL_NODE_TYPES = ['start', 'condition', 'loop', 'end', 'note', 'junction'];

export function createLinearFlow(steps = []) {
  const start = { id: 'start', type: 'start', x: 60, y: 160, label: 'Start' };
  const nodes = [start, ...steps.map((item, index) => ({ id: `node_${item.step_id}`, type: 'event', step_id: item.step_id, x: 250 + index * 220, y: 150, label: item.name }))];
  const end = { id: 'end', type: 'end', x: 250 + steps.length * 220, y: 160, label: 'End' };
  nodes.push(end);
  const chain = nodes.map(node => node.id);
  return { nodes, edges: chain.slice(0, -1).map((source, index) => ({ id: `edge_${crypto.randomUUID()}`, source, target: chain[index + 1], branch: 'next' })) };
}

export function normalizeFlow(trial) {
  const hasValidFlow = trial?.flow && Array.isArray(trial.flow.nodes) && trial.flow.nodes.length > 0;
  return hasValidFlow ? trial.flow : createLinearFlow(trial?.steps || []);
}

export function evaluateRule(rule, values = {}) {
  const resolve = path => {
    if (!path) return '';
    if (Object.prototype.hasOwnProperty.call(values, path)) return values[path];
    const keys = path.split('.');
    let current = values;
    for (const key of keys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return '';
      if (current == null || typeof current !== 'object') return '';
      current = current[key];
    }
    return current;
  };
  const actual = String(resolve(rule?.variable) ?? '');
  const expected = String(rule?.value ?? '');
  if (rule?.operator === 'not_equals') return actual !== expected;
  if (rule?.operator === 'contains') return actual.includes(expected);
  if (rule?.operator === 'greater_than') return Number(actual) > Number(expected);
  if (rule?.operator === 'less_than') return Number(actual) < Number(expected);
  return actual === expected;
}

export function compileTrialFlow(trial, runtimeValues = {}) {
  const flow = normalizeFlow(trial);
  const nodes = new Map(flow.nodes.map(node => [node.id, node]));
  const steps = new Map((trial.steps || []).map(item => [item.step_id, item]));
  const outgoing = id => flow.edges.filter(edge => edge.source === id);
  const result = [], loopVisits = new Map();
  // Auto-inject trial condition into rule evaluation scope (consistent with advanceRuntime);
  // trial.condition has lowest priority — runtimeValues may override it intentionally
  const evalValues = { condition: trial.condition, ...runtimeValues };
  let current = flow.nodes.find(node => node.type === 'start') || flow.nodes[0];
  let guard = 0;
  const MAX_TRANSITIONS = 5000;
  while (current && guard++ < MAX_TRANSITIONS) {
    // Skip disabled nodes
    if (current.enabled === false) {
      const edges = outgoing(current.id);
      const edge = edges.find(item => item.branch === 'next') || edges[0];
      current = edge ? nodes.get(edge.target) : null;
      continue;
    }
    // Skip note nodes (purely visual)
    if (current.type === 'note') {
      const edges = outgoing(current.id);
      const edge = edges[0];
      current = edge ? nodes.get(edge.target) : null;
      continue;
    }
    if (current.type === 'event' && steps.has(current.step_id)) result.push(steps.get(current.step_id));
    if (current.type === 'end') break;
    const edges = outgoing(current.id);
    let edge;
    if (current.type === 'condition') edge = edges.find(item => item.branch === (evaluateRule(current.rule, evalValues) ? 'true' : 'false'));
    else if (current.type === 'loop') {
      const count = loopVisits.get(current.id) || 0;
      const limit = Math.max(0, Number.isFinite(Number(current.max_iterations)) ? Number(current.max_iterations) : 1);
      const ruleAllows = !current.rule?.variable || evaluateRule(current.rule, evalValues);
      const repeat = count < limit && ruleAllows;
      loopVisits.set(current.id, count + 1);
      edge = edges.find(item => item.branch === (repeat ? 'body' : 'exit'));
    } else if (current.type === 'junction') edge = edges.find(item => item.branch === 'next') || edges[0];
    else edge = edges.find(item => item.branch === 'next') || edges[0];
    current = edge ? nodes.get(edge.target) : null;
  }
  return result;
}

export function validateFlow(flow, steps = []) {
  const errors = [], warnings = [], nodes = flow?.nodes || [], edges = flow?.edges || [];
  const responseVariables=steps.filter(step=>step.type==='response').flatMap(step=>[step.response_variable||'response',`answer.${step.response_variable||'response'}`,`answers.${step.response_variable||'response'}`]);
  const knownVariables=new Set(['','participant_language','participant_id','order_row','condition',...responseVariables,...steps.flatMap(step=>step.questionnaire?.questions||[]).flatMap(question=>[question.question_id,`answer.${question.question_id}`,`answers.${question.question_id}`])]);
  const starts = nodes.filter(node => node.type === 'start'), ends = nodes.filter(node => node.type === 'end');
  if (starts.length !== 1) errors.push(`Flow needs exactly one Start node (found ${starts.length})`);
  if (!ends.length) errors.push('Flow needs at least one End node');
  const ids = new Set(nodes.map(node => node.id));
  const stepIds = new Set(steps.map(step => step.step_id));
  edges.forEach(edge => { if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`Broken edge ${edge.id || `${edge.source}->${edge.target}`}`); });
  nodes.filter(node => node.type === 'event').forEach(node => { if (!stepIds.has(node.step_id)) errors.push(`Event node ${node.label || node.id} references a missing Step`); });
  const referencedSteps = new Set(nodes.filter(node => node.type === 'event').map(node => node.step_id));
  steps.forEach(step => { if (!referencedSteps.has(step.step_id)) warnings.push(`Step ${step.name} is not placed in the flow`); });
  nodes.forEach(node => {
    const outgoing = edges.filter(edge => edge.source === node.id);
    // Note nodes: no edge requirements (purely visual annotations)
    if (node.type === 'note') {
      if (outgoing.length) warnings.push(`Note ${node.label || node.id} has outgoing connections that will be ignored`);
      return;
    }
    // Junction nodes: need at least one input and one output
    if (node.type === 'junction') {
      const incoming = edges.filter(edge => edge.target === node.id);
      if (!incoming.length) errors.push(`Junction ${node.label || node.id} needs at least one incoming connection`);
      if (!outgoing.some(edge => edge.branch === 'next')) errors.push(`Junction ${node.label || node.id} needs a next connection`);
      if (outgoing.filter(edge => edge.branch === 'next').length > 1) errors.push(`Junction ${node.label || node.id} has more than one next connection`);
      return;
    }
    if (node.type === 'condition' && (!outgoing.some(edge => edge.branch === 'true') || !outgoing.some(edge => edge.branch === 'false'))) errors.push(`Condition ${node.label || node.id} needs true and false connections`);
    if (node.type === 'loop' && (!outgoing.some(edge => edge.branch === 'body') || !outgoing.some(edge => edge.branch === 'exit'))) errors.push(`Loop ${node.label || node.id} needs body and exit connections`);
    if (['start','event'].includes(node.type) && !outgoing.some(edge => edge.branch === 'next')) errors.push(`${node.label || node.id} needs a next connection`);
    const expected=node.type==='condition'?['true','false']:node.type==='loop'?['body','exit']:['start','event'].includes(node.type)?['next']:[];
    expected.forEach(branch=>{if(outgoing.filter(edge=>edge.branch===branch).length>1)errors.push(`${node.label||node.id} has more than one ${branch} connection`)});
    if(['condition','loop'].includes(node.type)&&node.rule?.variable&&!knownVariables.has(node.rule.variable))warnings.push(`${node.label||node.id} references unknown variable ${node.rule.variable}`);
    if(node.type==='loop'&&(!Number.isInteger(Number(node.max_iterations))||Number(node.max_iterations)<0))errors.push(`Loop ${node.label||node.id} needs a non-negative integer maximum`);
    if (node.type === 'end' && outgoing.length) warnings.push(`End node ${node.label || node.id} has ignored outgoing connections`);
  });
  if (starts.length === 1) {
    const reachable = new Set(), queue = [starts[0].id];
    let qhead = 0; while (qhead < queue.length) { const id = queue[qhead++]; if(reachable.has(id)) continue; reachable.add(id); edges.filter(edge=>edge.source===id).forEach(edge=>queue.push(edge.target)); }
    nodes.forEach(node => { if (!reachable.has(node.id)) errors.push(`Node ${node.label || node.id} is unreachable`); });
    if (!ends.some(node => reachable.has(node.id))) errors.push('No End node is reachable from Start');
  }
  // Iterative DFS with path tracking to prevent stack overflow on deep flows
  if (starts[0]) {
    const stack = [{ id: starts[0].id, path: [], edgeIndex: 0 }];
    const maxDepth = nodes.length * 50;
    while (stack.length > 0 && stack.length < maxDepth) {
      const frame = stack[stack.length - 1];
      const outgoing = edges.filter(edge => edge.source === frame.id);
      if (frame.edgeIndex >= outgoing.length) { stack.pop(); continue; }
      const edge = outgoing[frame.edgeIndex];
      frame.edgeIndex += 1;
      const cycleIndex = frame.path.indexOf(edge.target);
      if (cycleIndex >= 0) {
        const cycleNodeIds = [...frame.path.slice(cycleIndex), edge.target];
        const cycleNodes = cycleNodeIds.map(nid => nodes.find(node => node.id === nid)).filter(Boolean);
        if (!cycleNodes.some(node => node.type === 'loop')) {
          errors.push(`Cycle must pass through a Loop node: ${cycleNodes.map(node => node.label || node.id).join(' -> ')}`);
        }
        continue;
      }
      if (frame.path.length > nodes.length) continue;
      stack.push({ id: edge.target, path: [...frame.path, frame.id], edgeIndex: 0 });
    }
    if (stack.length >= maxDepth) errors.push('Flow cycle detection exceeded depth limit');
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
