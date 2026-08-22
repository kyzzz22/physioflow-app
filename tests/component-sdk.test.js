import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, connect, createProtocolGraph, createSequentialIdFactory, validateProtocolGraph } from '../src/core/index.js';
import { completeCurrentNode, createRuntimeState, startRuntime } from '../src/runtime/index.js';
import { createProjectComponentRegistry, exampleReactionButtonPackage, installComponentPackage, uninstallComponentPackage, validateComponentPackage } from '../src/sdk/index.js';

function protocolGraph() {
  return createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z', name: 'SDK test' });
}

function runtimeServices() {
  let sequence = 0;
  return {
    idFactory: prefix => `${prefix}_${++sequence}`,
    clock: { now: () => ({ iso: `2026-08-23T00:00:0${sequence}.000Z`, epochMs: 1000 + sequence, monotonicMs: 500 + sequence }) },
  };
}

test('component SDK validates and permission-gates a declarative package', () => {
  const componentPackage = exampleReactionButtonPackage();
  assert.equal(validateComponentPackage(componentPackage).valid, true);
  assert.throws(() => installComponentPackage(protocolGraph(), componentPackage), /require approval: events.emit/);
  const installed = installComponentPackage(protocolGraph(), componentPackage, { approvedPermissions: ['events.emit'], now: '2026-08-23T00:00:00.000Z' });
  assert.equal(installed.componentPackages.length, 1);
  assert.equal(createProjectComponentRegistry(installed).has('example.reaction-button', '1.0.0'), true);
});

test('SDK rejects executable control components and protects installed packages in use', () => {
  const unsafe = exampleReactionButtonPackage();
  unsafe.components[0].runtime.kind = 'condition';
  assert.ok(validateComponentPackage(unsafe).errors.some(error => error.includes('sandboxed participant')));

  const componentPackage = exampleReactionButtonPackage();
  let protocol = installComponentPackage(protocolGraph(), componentPackage, { approvedPermissions: ['events.emit'] });
  protocol = addNode(protocol, 'example.reaction-button', { id: 'sdk_button', config: componentPackage.components[0].defaultConfig }).protocol;
  assert.throws(() => uninstallComponentPackage(protocol, componentPackage.packageId, componentPackage.version), /used by 1 node/);
});

test('installed SDK component validates and executes through the project registry', () => {
  const componentPackage = exampleReactionButtonPackage();
  let protocol = installComponentPackage(protocolGraph(), componentPackage, { approvedPermissions: ['events.emit'] });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  protocol = addNode(protocol, 'example.reaction-button', { id: 'sdk_button', label: 'Respond', config: componentPackage.components[0].defaultConfig }).protocol;
  protocol = connect(protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'sdk_button', portId: 'in' }).protocol;
  protocol = connect(protocol, 'control', { nodeId: 'sdk_button', portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  const registry = createProjectComponentRegistry(protocol);
  assert.equal(validateProtocolGraph(protocol, registry).valid, true);
  const state = createRuntimeState(protocol, { sessionId: 'sdk_session', startedAtEpochMs: 1000, startedAtMonotonicMs: 500 });
  const started = startRuntime(state, protocol, registry, runtimeServices());
  assert.equal(started.state.currentNodeId, 'sdk_button');
  const completed = completeCurrentNode(started.state, protocol, registry, runtimeServices(), { outputs: { pressed: true } });
  assert.equal(completed.state.status, 'completed');
  assert.equal(completed.state.outputs.sdk_button.pressed, true);
});

test('graph validation enforces SDK variable-read permission', () => {
  const componentPackage = exampleReactionButtonPackage();
  componentPackage.components[0].defaultConfig.ui.root.children[0].bindings = { text: 'variables.secret' };
  let protocol = installComponentPackage(protocolGraph(), componentPackage, { approvedPermissions: ['events.emit'] });
  protocol.variables = [{ name: 'secret', type: 'string', scope: 'session', defaultValue: 'hidden' }];
  protocol = addNode(protocol, 'example.reaction-button', { id: 'sdk_reader', config: componentPackage.components[0].defaultConfig }).protocol;
  const check = validateProtocolGraph(protocol, createProjectComponentRegistry(protocol));
  assert.ok(check.errors.some(error => error.code === 'sdk.permission_variable_read'));
});
