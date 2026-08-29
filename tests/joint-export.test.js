import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJointExportFiles, channelsForExport, jointDataDictionary, sensorColumns, sensorRowsToObjects, sensorToCsv } from '../src/data/jointExport.js';
import { exampleSimulatedConnector, installDeviceConnector } from '../src/devices/index.js';
import { createProtocolGraph, createSequentialIdFactory } from '../src/core/index.js';
import { bundle } from '../src/exporter.js';
import { block, protocol, step, trial } from '../src/domain.js';

const SENSOR = {
  time: ['2026-08-28T10:00:00.000000Z', '2026-08-28T10:00:01.000000Z', '2026-08-28T10:00:02.000000Z'],
  eda: [1.5, null, 2.5],
  hr: [70, 71, 72],
};

function sessionFiles() {
  const p = protocol({
    config_hash: 'hash',
    deviceConnectors: [exampleSimulatedConnector()],
    blocks: [block({ trials: [trial({ steps: [step('questionnaire', { name: 'Survey', questionnaire: { questionnaire_id: 'q', questions: [{ question_id: 'a', type: 'short_text', required: true, prompt_i18n: { en: 'Answer' } }] } })] })] })],
  });
  const session = { session_id: 'session_joint', participant_id: 'P,001', status: 'completed', protocol_hash: 'hash' };
  return bundle(session, p, []);
}

test('columnar sensor payload flattens to rectangular rows keeping gaps empty', () => {
  assert.deepEqual(sensorColumns(SENSOR), ['time', 'eda', 'hr']);
  const rows = sensorRowsToObjects(SENSOR);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { time: SENSOR.time[0], eda: 1.5, hr: 70 });
  assert.equal(rows[1].eda, null);
  // A missing sample must not silently become zero.
  const lines = sensorToCsv(SENSOR).trim().split('\n');
  assert.equal(lines[0], 'time,eda,hr');
  assert.equal(lines[2], '2026-08-28T10:00:01.000000Z,,71');
});

test('empty sensor payload yields a header-only CSV, not a broken file', () => {
  assert.deepEqual(sensorColumns({ time: [] }), ['time']);
  assert.equal(sensorToCsv({ time: [] }).trim(), 'time');
});

test('channels for export come from the connector, falling back to device event payloads', () => {
  const connector = exampleSimulatedConnector();
  const graph = installDeviceConnector(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Joint', now: '2026-08-28T00:00:00.000Z' }),
    connector,
    { approvedPermissions: connector.permissions, now: '2026-08-28T00:00:00.000Z' },
  );
  assert.deepEqual(channelsForExport(graph), ['signal']);
  const fallback = channelsForExport({ protocolId: 'no-connector' }, [
    { payload: { time: '2026-08-28T10:00:00Z', emg: 0.4, label: 'x' } },
  ]);
  assert.deepEqual(fallback, ['emg']);
  assert.deepEqual(channelsForExport({ protocolId: 'empty' }, []), []);
});

test('joint export merges both legs and records provenance', () => {
  const pfFiles = sessionFiles();
  const { files, manifest } = buildJointExportFiles({
    sessionFiles: pfFiles,
    biodb: { sensor: SENSOR, events: [{ event_id: 'e1' }], experiment: { experiment_id: 'exp_1', dictionary: { signal: { unit: 'a.u.' } } } },
    meta: { sessionId: 'session_joint', participantId: 'P,001', experimentId: 'exp_1', startTime: '2026-08-28T10:00:00Z', endTime: '2026-08-28T10:00:03Z', baseUrl: 'http://localhost:5002', channels: ['eda', 'hr'] },
  });

  assert.equal(manifest.contractVersion, '1.0.0');
  assert.equal(manifest.sources.pf.included, true);
  assert.equal(manifest.sources.biodb.sensorPoints, 3);
  assert.deepEqual(manifest.sources.biodb.sensorColumns, ['eda', 'hr']);
  assert.equal(manifest.sources.biodb.events, 1);
  assert.equal(manifest.sources.biodb.experiment, 'exp_1');
  assert.equal(manifest.sources.biodb.dictionaryIncluded, true);
  assert.equal(manifest.window.sensorStart, SENSOR.time[0]);
  assert.equal(manifest.window.sensorEnd, SENSOR.time[2]);
  assert.deepEqual(manifest.warnings, []);

  // PF files survive at the top level, BioDB files live under biodb/.
  assert.ok(files['export_manifest.json']);
  assert.ok(files['channel_dictionary.json']);
  assert.ok(files['biodb/sensor_data.csv']);
  assert.ok(files['biodb/events.json']);
  assert.ok(files['biodb/experiment.json']);
  assert.ok(files['joint_manifest.json']);
  assert.ok(files['joint_data_dictionary.json']);
  assert.equal(JSON.parse(files['biodb/events.json'])[0].event_id, 'e1');
});

test('a failed BioDB leg still archives the PF session and says why', () => {
  const pfFiles = sessionFiles();
  const { files, manifest } = buildJointExportFiles({
    sessionFiles: pfFiles,
    biodb: null,
    meta: { sessionId: 's', participantId: 'P', channels: ['eda'], biodbError: 'HTTP 500' },
  });
  assert.equal(manifest.sources.biodb.included, false);
  assert.equal(manifest.sources.biodb.error, 'HTTP 500');
  assert.equal(manifest.sources.biodb.sensorPoints, 0);
  assert.match(manifest.warnings[0], /BioDB leg failed: HTTP 500/);
  assert.ok(files['export_manifest.json']);
  assert.equal(files['biodb/sensor_data.csv'], undefined);
});

test('an empty or experiment-less BioDB response is reported, not hidden', () => {
  const empty = buildJointExportFiles({
    sessionFiles: sessionFiles(),
    biodb: { sensor: { time: [] }, events: [], experiment: null },
    meta: { participantId: 'P' },
  });
  assert.equal(empty.manifest.sources.biodb.sensorPoints, 0);
  assert.match(empty.manifest.warnings.join(' '), /no sensor samples/);
  assert.match(empty.manifest.warnings.join(' '), /No experiment metadata/);
});

test('joint data dictionary describes the added files', () => {
  const dict = jointDataDictionary();
  assert.ok(dict.tables['biodb/sensor_data']);
  assert.ok(dict.notes.some(note => note.includes('UTC')));
});
