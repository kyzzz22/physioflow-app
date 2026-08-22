import test from 'node:test';
import assert from 'node:assert/strict';
import { addNode, connect, createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory } from '../src/core/index.js';
import { ControlHandlerRegistry, createRuntimeState, startRuntime } from '../src/runtime/index.js';

function services(controlHandlers) {
  let tick = 0;
  return {
    controlHandlers,
    idFactory: prefix => `${prefix}_${++tick}`,
    clock: { now: () => ({ iso: new Date(1000 + tick).toISOString(), epochMs: 1000 + tick, monotonicMs: 500 + tick }) },
  };
}

test('trusted custom control handler routes through a declared component port', () => {
  const components = createCoreComponentRegistry();
  components.register({
    type: 'lab.parity-router', version: '1.0.0', label: 'Parity router', category: 'control',
    runtime: { kind: 'handler', handlerId: 'lab.parity', handlerVersion: '1.0.0' },
    ports: [
      { id: 'in', kind: 'control', direction: 'input', required: true },
      { id: 'value', kind: 'data', direction: 'input', dataType: 'number', required: true },
      { id: 'even', kind: 'control', direction: 'output', required: true },
      { id: 'odd', kind: 'control', direction: 'output', required: true },
    ],
    events: ['lab_parity_evaluated'],
  });
  const handlers = new ControlHandlerRegistry().register({
    id: 'lab.parity', version: '1.0.0', allowedEvents: ['lab_parity_evaluated'],
    execute: context => ({ selectedPort: Number(context.inputs.value) % 2 ? 'odd' : 'even', eventType: 'lab_parity_evaluated', payload: { value: context.inputs.value } }),
  });
  const ids = createSequentialIdFactory();
  let protocol = createProtocolGraph({ idFactory: ids, name: 'Handler test', now: '2026-08-23T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const evenEnd = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  protocol.variables = [{ name: 'value', type: 'number', scope: 'session', defaultValue: 4 }];
  protocol = addNode(protocol, 'lab.parity-router', { id: 'router', bindings: { value: { kind: 'variable', variable: 'value' } } }).protocol;
  protocol = addNode(protocol, 'core.end', { id: 'odd_end', label: 'Odd end' }).protocol;
  protocol = connect(protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'router', portId: 'in' }).protocol;
  protocol = connect(protocol, 'control', { nodeId: 'router', portId: 'even' }, { nodeId: evenEnd.id, portId: 'in' }).protocol;
  protocol = connect(protocol, 'control', { nodeId: 'router', portId: 'odd' }, { nodeId: 'odd_end', portId: 'in' }).protocol;
  const state = createRuntimeState(protocol, { sessionId: 'handler_session', startedAtEpochMs: 1000, startedAtMonotonicMs: 500 });
  const result = startRuntime(state, protocol, components, services(handlers));
  assert.equal(result.state.status, 'completed');
  assert.equal(result.events.find(event => event.eventType === 'lab_parity_evaluated').payload.selectedPort, 'even');
  assert.equal(result.events.at(-1).nodeId, evenEnd.id);
});

test('control handlers receive a deeply frozen copy and cannot mutate runtime state', () => {
  const handlers = new ControlHandlerRegistry().register({
    id: 'lab.mutator', version: '1.0.0',
    execute: context => { context.variables.score = 99; return { selectedPort: 'next' }; },
  });
  assert.throws(() => handlers.execute('lab.mutator', '1.0.0', { variables: { score: 1 } }), /read only|Cannot assign/);
});

test('control handler registry rejects async execution and undeclared events', () => {
  const asyncHandlers = new ControlHandlerRegistry().register({ id: 'lab.async', version: '1.0.0', execute: async () => ({ selectedPort: 'next' }) });
  assert.throws(() => asyncHandlers.execute('lab.async', '1.0.0', {}), /synchronously/);
  const eventHandlers = new ControlHandlerRegistry().register({ id: 'lab.event', version: '1.0.0', allowedEvents: ['allowed'], execute: () => ({ selectedPort: 'next', eventType: 'not_allowed' }) });
  assert.throws(() => eventHandlers.execute('lab.event', '1.0.0', {}), /cannot emit/);
});

test('runtime rejects a control handler branch that is not declared by its component', () => {
  const components = createCoreComponentRegistry();
  components.register({
    type: 'lab.invalid-router', version: '1.0.0', label: 'Invalid router', category: 'control',
    runtime: { kind: 'handler', handlerId: 'lab.invalid', handlerVersion: '1.0.0' },
    ports: [
      { id: 'in', kind: 'control', direction: 'input', required: true },
      { id: 'next', kind: 'control', direction: 'output', required: true },
    ],
  });
  const handlers = new ControlHandlerRegistry().register({ id: 'lab.invalid', version: '1.0.0', execute: () => ({ selectedPort: 'missing' }) });
  const ids = createSequentialIdFactory();
  let protocol = createProtocolGraph({ idFactory: ids, name: 'Invalid handler branch', now: '2026-08-23T00:00:00.000Z' });
  const start = protocol.graph.nodes.find(node => node.component.type === 'core.start');
  const end = protocol.graph.nodes.find(node => node.component.type === 'core.end');
  protocol.graph.edges = [];
  protocol = addNode(protocol, 'lab.invalid-router', { id: 'router' }).protocol;
  protocol = connect(protocol, 'control', { nodeId: start.id, portId: 'next' }, { nodeId: 'router', portId: 'in' }).protocol;
  protocol = connect(protocol, 'control', { nodeId: 'router', portId: 'next' }, { nodeId: end.id, portId: 'in' }).protocol;
  const result = startRuntime(createRuntimeState(protocol, { sessionId: 'invalid_handler_session', startedAtEpochMs: 1000, startedAtMonotonicMs: 500 }), protocol, components, services(handlers));
  assert.equal(result.state.status, 'failed');
  assert.match(result.state.error, /selected undeclared port missing/);
});
