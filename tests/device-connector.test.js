import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtocolGraph, createSequentialIdFactory } from '../src/core/index.js';
import { createSimulatedDeviceAdapter, DeviceConnectorSession, exampleSimulatedConnector, installDeviceConnector, validateDeviceConnector } from '../src/devices/index.js';

function services() {
  let tick = 0;
  return {
    idFactory: prefix => `${prefix}_${++tick}`,
    clock: { now: () => ({ iso: new Date(1000 + tick).toISOString(), epochMs: 1000 + tick, monotonicMs: 500 + tick }) },
  };
}

function protocol() {
  return createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Device connector test', now: '2026-08-23T00:00:00.000Z' });
}

test('device connector installation requires explicit permissions', () => {
  const connector = exampleSimulatedConnector();
  assert.equal(validateDeviceConnector(connector).valid, true);
  assert.throws(() => installDeviceConnector(protocol(), connector), /device.connect, device.read, device.write/);
  const installed = installDeviceConnector(protocol(), connector, { approvedPermissions: connector.permissions, now: '2026-08-23T00:00:00.000Z' });
  assert.equal(installed.deviceConnectors[0].connectorId, connector.connectorId);
  assert.deepEqual(installed.deviceConnectors[0].approvedPermissions, connector.permissions);
});

test('device session records connected I/O with complete provenance', async () => {
  const connector = { ...exampleSimulatedConnector(), approvedPermissions: ['device.connect', 'device.read', 'device.write'] };
  const adapter = createSimulatedDeviceAdapter({ samples: [3.25], deviceId: 'SIM-TEST' });
  const events = [];
  const session = new DeviceConnectorSession({ connector, adapter, sessionId: 'session_device', services: services(), onEvent: event => events.push(event) });
  await session.connect({ port: 'virtual' });
  const sample = await session.read('signal');
  await session.write('marker', 'stimulus_onset');
  await session.disconnect();

  assert.deepEqual(events.map(event => event.eventType), ['device_connection_requested', 'device_connected', 'device_sample_received', 'device_marker_sent', 'device_disconnected']);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4, 5]);
  assert.equal(sample.payload.value, 3.25);
  assert.equal(events[2].connector.id, connector.connectorId);
  assert.equal(events[2].device.deviceId, 'SIM-TEST');
  assert.equal(adapter.markers[0].value, 'stimulus_onset');
  assert.equal(session.provenance().status, 'disconnected');
});

test('device recovery logs failed attempts and restored provenance', async () => {
  const connector = { ...exampleSimulatedConnector(), approvedPermissions: ['device.connect', 'device.read', 'device.write'] };
  let attempts = 0;
  const adapter = {
    async connect() { attempts += 1; if (attempts < 3) throw new Error(`offline ${attempts}`); return { deviceId: 'RECOVERED-1', firmware: '2.0' }; },
    async disconnect() {},
    async read() { return { value: 1 }; },
    async write() {},
  };
  const events = [];
  const session = new DeviceConnectorSession({ connector, adapter, sessionId: 'session_recovery', services: services(), onEvent: event => events.push(event) });
  const recovered = await session.recover({}, { maxAttempts: 3 });
  assert.equal(recovered.eventType, 'device_recovered');
  assert.equal(recovered.payload.attempt, 3);
  assert.equal(session.status, 'connected');
  assert.equal(session.provenance().device.deviceId, 'RECOVERED-1');
  assert.equal(events.filter(event => event.eventType === 'device_recovery_attempt_failed').length, 2);
  assert.equal(events.filter(event => event.eventType === 'device_connection_failed').length, 2);
});

test('device session blocks unapproved read and write operations', async () => {
  const connector = { ...exampleSimulatedConnector(), approvedPermissions: ['device.connect'] };
  const session = new DeviceConnectorSession({ connector, adapter: createSimulatedDeviceAdapter(), sessionId: 'session_permissions', services: services() });
  await session.connect();
  await assert.rejects(() => session.read('signal'), /device.read is not approved/);
  await assert.rejects(() => session.write('marker', 'x'), /device.write is not approved/);
});
