import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceSampler, maxInputSampleRateHz, resolveDeviceConnector } from '../src/runtime/index.js';

test('resolveDeviceConnector finds an installed connector by node config', () => {
  const protocol = { deviceConnectors: [{ connectorId: 'org.example.sim', version: '1.0.0' }] };
  const node = { config: { deviceConnectorId: 'org.example.sim' } };
  assert.equal(resolveDeviceConnector(protocol, node).connector.connectorId, 'org.example.sim');
  assert.equal(resolveDeviceConnector(protocol, { config: {} }), null);
  assert.equal(resolveDeviceConnector(protocol, { config: { deviceConnectorId: 'missing' } }), null);
});

test('maxInputSampleRateHz picks the highest input channel rate with a default', () => {
  const connector = {
    channels: [
      { id: 'a', direction: 'input', sampleRateHz: 10 },
      { id: 'b', direction: 'input', sampleRateHz: 100 },
      { id: 'c', direction: 'output' },
    ],
  };
  assert.equal(maxInputSampleRateHz(connector), 100);
  assert.equal(maxInputSampleRateHz({ channels: [] }), 10);
});

test('createDeviceSampler drives read at the declared rate and stops', async () => {
  const reads = [];
  const session = { read: async channelId => { reads.push(channelId); return { value: 1 }; } };
  const sampler = createDeviceSampler({ session, channels: [{ id: 'signal' }], sampleRateHz: 20 });
  assert.equal(sampler.isRunning(), false);
  sampler.start();
  assert.equal(sampler.isRunning(), true);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.ok(reads.length >= 3, `read ${reads.length} times at 20 Hz over 220 ms`);
  sampler.stop();
  assert.equal(sampler.isRunning(), false);
  const countAtStop = reads.length;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(reads.length, countAtStop, 'no reads after stop');
});
