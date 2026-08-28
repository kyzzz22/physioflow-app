import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtocolGraph, createSequentialIdFactory } from '../src/core/index.js';
import { exampleSimulatedConnector, installDeviceConnector } from '../src/devices/index.js';
import { buildGraphSessionFiles } from '../src/data/index.js';
import { bundle } from '../src/exporter.js';
import { block, protocol, step, trial } from '../src/domain.js';
import { channelDataDictionary, dictionaryPayload } from '../src/data/channelDictionary.js';

function graphProtocol() {
  const connector = exampleSimulatedConnector();
  const base = createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Channel dictionary test', now: '2026-08-25T00:00:00.000Z' });
  const protocol = installDeviceConnector(base, connector, { approvedPermissions: connector.permissions, now: '2026-08-25T00:00:00.000Z' });
  return { protocol, connector };
}

function legacyProtocolWithConnector(connector) {
  const p = protocol({
    config_hash: 'hash',
    deviceConnectors: [connector],
    blocks: [block({ trials: [trial({ steps: [step('questionnaire', { name: 'Survey', questionnaire: { questionnaire_id: 'q', questions: [{ question_id: 'a', type: 'short_text', required: true, prompt_i18n: { en: 'Answer' } }] } })] })] })],
  });
  return p;
}

test('channel dictionary extracts dataType/unit/sampleRate from legacy deviceConnectors', () => {
  const connector = exampleSimulatedConnector();
  const dict = channelDataDictionary({ protocolId: 'legacy', name: 'Legacy', version: '1.0.0', deviceConnectors: [connector] });
  assert.equal(dict.contractVersion, '1.0.0');
  assert.deepEqual(dict.inputChannels, ['signal']);
  assert.deepEqual(dict.outputChannels, ['marker']);
  assert.deepEqual(dict.channels.signal, {
    connectorId: 'org.physioflow.simulated-sensor',
    connectorVersion: '1.0.0',
    label: 'signal',
    dataType: 'number',
    unit: 'a.u.',
    sampleRateHz: 100,
    direction: 'input',
  });
  assert.deepEqual(dict.channels.marker, {
    connectorId: 'org.physioflow.simulated-sensor',
    connectorVersion: '1.0.0',
    label: 'marker',
    dataType: 'string',
    unit: null,
    sampleRateHz: null,
    direction: 'output',
  });
});

test('channel dictionary follows V2 graph device-connector nodes', () => {
  const { protocol, connector } = graphProtocol();
  const dict = channelDataDictionary(protocol);
  assert.deepEqual(dict.inputChannels, ['signal']);
  assert.equal(dict.connectors[connector.connectorId].name, 'Simulated Physiology Sensor');
  assert.equal(dict.protocol.id, protocol.protocolId);
  assert.equal(dict.protocol.name, 'Channel dictionary test');
});

test('dictionary payload keeps input channels only in BioDB shape', () => {
  const { protocol } = graphProtocol();
  const payload = dictionaryPayload(protocol);
  assert.deepEqual(Object.keys(payload.dictionary), ['signal']);
  assert.deepEqual(payload.dictionary.signal, {
    label: 'signal',
    unit: 'a.u.',
    type: 'number',
    sampleRateHz: 100,
    direction: 'input',
    connectorId: 'org.physioflow.simulated-sensor',
    connectorVersion: '1.0.0',
  });
  assert.equal(dictionaryPayload({ protocolId: 'empty', deviceConnectors: [] }), null);
});

test('graph session export bundles channel_dictionary.json and updates manifest counts', () => {
  const { protocol } = graphProtocol();
  const session = { session_id: 'session_1', participant_id: 'P,001', status: 'completed', runtime_snapshot: { status: 'completed' } };
  const events = [];
  const files = buildGraphSessionFiles(session, protocol, events, []);
  assert.ok(files['channel_dictionary.json']);
  assert.ok(files['channel_dictionary.csv']);
  const parsed = JSON.parse(files['channel_dictionary.json']);
  assert.deepEqual(parsed.inputChannels, ['signal']);
  assert.match(files['channel_dictionary.csv'], /signal,org\.physioflow\.simulated-sensor,1\.0\.0,signal,number,a\.u\.,100,input/);
  const manifest = JSON.parse(files['manifest.json']);
  assert.equal(manifest.counts.channels, 2);
  assert.equal(manifest.counts.connectors, 1);
  assert.match(files['data_dictionary.json'], /channels/);
});

test('generic exporter bundle includes channel_dictionary.json', () => {
  const p = legacyProtocolWithConnector(exampleSimulatedConnector());
  const session = { session_id: 'session_2', participant_id: 'P,002', protocol_hash: 'abc', status: 'completed' };
  const files = bundle(session, p, []);
  assert.ok(files['channel_dictionary.json']);
  const manifest = JSON.parse(files['export_manifest.json']);
  assert.equal(manifest.counts.channels, 1);
  assert.equal(manifest.counts.connectors, 1);
  assert.match(files['data_dictionary.csv'], /channel_dictionary\.json/);
});
