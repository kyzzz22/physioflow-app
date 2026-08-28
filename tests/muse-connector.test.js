import test from 'node:test';
import assert from 'node:assert/strict';
import { installDeviceConnector, validateDeviceConnector } from '../src/devices/index.js';
import { channelDataDictionary, dictionaryPayload } from '../src/data/channelDictionary.js';
import { createProtocolGraph, createSequentialIdFactory } from '../src/core/index.js';
import { createMuseDeviceAdapter, museConnector } from '../src/devices/museConnector.js';
import {
  EEG_SCALE_UV,
  MUSE_CHARACTERISTICS,
  MUSE_EEG_CHANNELS,
  decodeEegSamples,
  decodeResponse,
  decodeUnsigned12BitData,
  encodeCommand,
  parseAccelerometer,
  parseEegNotification,
  parseGyroscope,
  parseTelemetry,
} from '../src/devices/museProtocol.js';

// Big-endian 12-bit packing used by the headset: 3 bytes carry 2 samples.
function pack12Bit(values) {
  const bytes = [];
  for (let i = 0; i < values.length; i += 2) {
    const a = values[i] ?? 0;
    const b = values[i + 1] ?? 0;
    bytes.push((a >> 4) & 0xff, ((a & 0x0f) << 4) | ((b >> 8) & 0x0f), b & 0xff);
  }
  return Uint8Array.from(bytes);
}

function eegNotificationView(index, values) {
  const payload = pack12Bit(values);
  const buffer = new ArrayBuffer(2 + payload.length);
  const view = new DataView(buffer);
  view.setUint16(0, index);
  new Uint8Array(buffer, 2).set(payload);
  return view;
}

function fakeTransport({ hasAthena = false } = {}) {
  const subscribers = new Map();
  const writes = [];
  return {
    writes,
    subscribers,
    disconnected: false,
    async connect() { return { deviceId: 'MUSE-TEST', name: 'Muse-S' }; },
    async hasCharacteristic(uuid) { return hasAthena && uuid === MUSE_CHARACTERISTICS.athenaSensor; },
    async getCharacteristic(uuid) { return { uuid }; },
    async subscribe(handle, handler) { subscribers.set(handle.uuid, handler); return async () => subscribers.delete(handle.uuid); },
    async write(handle, bytes) { writes.push({ uuid: handle.uuid, bytes: [...bytes] }); },
    async disconnect() { this.disconnected = true; },
    emit(uuid, view) { subscribers.get(uuid)?.(view); },
  };
}

test('12-bit unpacking round-trips the values the headset packs', () => {
  const values = [0x800, 0x000, 0xfff, 0x001, 0x7ff, 0x801, 0x2ac, 0xd31, 0x123, 0xabc, 0x0ff, 0xf0f];
  assert.deepEqual(decodeUnsigned12BitData(pack12Bit(values)), values);
});

test('EEG samples are converted to microvolts around the 0x800 midpoint', () => {
  const samples = decodeEegSamples(pack12Bit([0x800, 0x000, 0xfff]));
  assert.equal(samples[0], 0);
  assert.equal(samples[1], EEG_SCALE_UV * -0x800);
  assert.equal(samples[2], EEG_SCALE_UV * 0x7ff);
});

test('EEG notification carries a uint16 packet index plus 12 samples', () => {
  const packet = parseEegNotification(eegNotificationView(7, Array(12).fill(0x800)));
  assert.equal(packet.index, 7);
  assert.equal(packet.samples.length, 12);
  assert.ok(packet.samples.every(value => value === 0));
});

test('telemetry, accelerometer and gyroscope notifications decode with their scales', () => {
  const buffer = new ArrayBuffer(10);
  const view = new DataView(buffer);
  view.setUint16(0, 5);
  view.setUint16(2, 512);
  view.setUint16(4, 2);
  view.setUint16(8, 25);
  assert.deepEqual(parseTelemetry(view), { sequenceId: 5, batteryLevel: 1, fuelGaugeVoltage: 4.4, temperature: 25 });

  const imuBuffer = new ArrayBuffer(20);
  const imuView = new DataView(imuBuffer);
  imuView.setUint16(0, 3);
  imuView.setInt16(2, 1000);
  imuView.setInt16(4, -1000);
  imuView.setInt16(6, 0);
  const accel = parseAccelerometer(imuView);
  assert.equal(accel.sequenceId, 3);
  assert.equal(accel.samples.length, 3);
  assert.equal(accel.samples[0].x, 0.0000610352 * 1000);
  assert.equal(accel.samples[0].y, 0.0000610352 * -1000);
  assert.equal(parseGyroscope(imuView).samples[0].x, 0.0074768 * 1000);
});

test('control commands use the length-prefixed frame the headset expects', () => {
  assert.deepEqual([...encodeCommand('d')], [0x02, 0x64, 0x0a]);
  assert.equal(decodeResponse(encodeCommand('d')), 'd\n');
  assert.equal(decodeResponse(new Uint8Array([])), '');
});

test('muse connector passes device connector validation', () => {
  const check = validateDeviceConnector(museConnector());
  assert.deepEqual(check.errors, []);
  assert.equal(check.valid, true);
  assert.deepEqual(museConnector().channels.map(channel => channel.id), ['TP9', 'AF7', 'AF8', 'TP10', 'marker']);
  assert.equal(museConnector().channels[0].sampleRateHz, 256);
  assert.equal(museConnector().channels[0].unit, 'uV');
});

test('adapter streams notification samples through read() in order', async () => {
  const transport = fakeTransport();
  const adapter = createMuseDeviceAdapter({ transport, now: () => 1000 });
  const descriptor = await adapter.connect();
  assert.equal(descriptor.deviceId, 'MUSE-TEST');
  assert.equal(descriptor.firmwareFamily, 'classic');

  const expected = [0x800, 0x810, 0x820, 0x830, 0x840, 0x850, 0x860, 0x870, 0x880, 0x890, 0x8a0, 0x8b0];
  transport.emit(MUSE_EEG_CHANNELS[0].characteristic, eegNotificationView(0, expected));
  const decoded = expected.map(raw => EEG_SCALE_UV * (raw - 0x800));
  for (const value of decoded) {
    const sample = await adapter.read('TP9');
    assert.ok(Math.abs(sample.value - value) < 1e-9);
  }
  assert.equal(adapter.buffered('TP9'), 0);
  await assert.rejects(() => adapter.read('TP9'), /No Muse sample buffered/);
});

test('adapter starts the headset with the muse-js command sequence', async () => {
  const transport = fakeTransport();
  const adapter = createMuseDeviceAdapter({ transport });
  await adapter.connect();
  const commands = transport.writes.map(write => String.fromCharCode(...write.bytes).slice(1).trim());
  assert.deepEqual(commands, ['h', 'p21', 's', 'd']);
  assert.equal(transport.writes[1].bytes[0], 4);
});

test('adapter rejects Athena firmware instead of mis-decoding it', async () => {
  const transport = fakeTransport({ hasAthena: true });
  const adapter = createMuseDeviceAdapter({ transport });
  await assert.rejects(() => adapter.connect(), /Athena.*not supported/);
});

test('markers are recorded locally because the headset has no hardware marker input', async () => {
  const transport = fakeTransport();
  const adapter = createMuseDeviceAdapter({ transport, now: () => 4242 });
  await adapter.connect();
  const marker = await adapter.write('marker', 'stimulus_onset');
  assert.deepEqual(marker, { channelId: 'marker', value: 'stimulus_onset', timestamp: 4242 });
  assert.deepEqual(adapter.markers, [marker]);
  await assert.rejects(() => adapter.write('TP9', 1), /cannot write to channel/);
});

test('the queue is bounded so a slow sampler cannot grow memory without limit', async () => {
  const transport = fakeTransport();
  const adapter = createMuseDeviceAdapter({ transport, queueLimit: 8, now: () => 0 });
  await adapter.connect();
  transport.emit(MUSE_EEG_CHANNELS[1].characteristic, eegNotificationView(0, Array(12).fill(0x800)));
  assert.equal(adapter.buffered('AF7'), 8);
});

test('installed muse channels feed the D4 channel dictionary end to end', () => {
  const connector = museConnector();
  const protocol = installDeviceConnector(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), name: 'Muse study', now: '2026-08-28T00:00:00.000Z' }),
    connector,
    { approvedPermissions: connector.permissions, now: '2026-08-28T00:00:00.000Z' },
  );
  const dict = channelDataDictionary(protocol);
  assert.deepEqual(dict.inputChannels, ['TP9', 'AF7', 'AF8', 'TP10']);
  assert.deepEqual(dict.outputChannels, ['marker']);
  assert.deepEqual(dict.channels.TP9, {
    connectorId: 'org.physioflow.muse-eeg',
    connectorVersion: '1.0.0',
    label: 'TP9',
    dataType: 'number',
    unit: 'uV',
    sampleRateHz: 256,
    direction: 'input',
  });
  const payload = dictionaryPayload(protocol);
  assert.deepEqual(Object.keys(payload.dictionary), ['TP9', 'AF7', 'AF8', 'TP10']);
  assert.equal(payload.dictionary.TP9.unit, 'uV');
  assert.equal(payload.dictionary.TP9.type, 'number');
  assert.equal(payload.dictionary.TP9.sampleRateHz, 256);
});
