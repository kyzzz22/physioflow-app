import { DEVICE_CONNECTOR_SDK_VERSION } from './deviceConnector.js';
import { createWebBluetoothTransport } from './transports/webBluetooth.js';
import {
  MUSE_CHARACTERISTICS,
  MUSE_COMMANDS,
  MUSE_EEG_CHANNELS,
  MUSE_EEG_FREQUENCY,
  MUSE_EEG_SAMPLES_PER_READING,
  MUSE_SERVICE_UUID,
  MUSE_UUID_NAMESPACE,
  encodeCommand,
  parseEegNotification,
} from './museProtocol.js';

// Muse EEG headset connector (Classic firmware: Muse 1 / Muse 2 / Muse S Gen 1-2).
//
// The headset streams samples as BLE notifications rather than answering polls,
// so the adapter buffers each electrode's samples into a bounded queue and
// `read()` pops the oldest one. Packet timestamps are reconstructed from the
// uint16 packet index because the device does not ship a clock.

const DEFAULT_QUEUE_LIMIT = 4096; // ~16 s per channel at 256 Hz

/** Connector descriptor wired into the protocol and used by the device runtime. */
export function museConnector(options = {}) {
  const channels = (options.includeAux ? MUSE_EEG_CHANNELS : MUSE_EEG_CHANNELS.slice(0, 4))
    .map(channel => ({ id: channel.id, direction: 'input', dataType: 'number', unit: 'uV', sampleRateHz: MUSE_EEG_FREQUENCY }));
  channels.push({ id: 'marker', direction: 'output', dataType: 'string', unit: null });
  return {
    sdkVersion: DEVICE_CONNECTOR_SDK_VERSION,
    connectorId: options.connectorId || 'org.physioflow.muse-eeg',
    version: '1.0.0',
    name: 'Muse EEG Headset',
    transport: 'bluetooth',
    permissions: ['device.connect', 'device.read', 'device.write'],
    channels,
  };
}

/**
 * Rebuild a monotonic timestamp from the device's uint16 packet index.
 * Muse has no clock; muse-js derives time from index deltas and handles the
 * 16-bit wrap the same way.
 */
export function createPacketTimestampResolver({ frequency, samplesPerReading, now = () => Date.now() }) {
  const deltaMs = 1000 * (1 / frequency) * samplesPerReading;
  let lastIndex = null;
  let lastTimestamp = null;
  return index => {
    if (lastIndex === null) {
      lastIndex = index;
      lastTimestamp = now() - deltaMs;
      return lastTimestamp;
    }
    let current = index;
    while (lastIndex - current > 0x1000) current += 0x10000;
    if (current !== lastIndex) {
      lastTimestamp += deltaMs * (current - lastIndex);
      lastIndex = current;
    }
    return lastTimestamp;
  };
}

/**
 * Device adapter for a Classic Muse headset.
 * `transport` is injectable so protocol behaviour can be tested without a radio
 * and so a native Tauri BLE backend can replace Web Bluetooth on desktop.
 */
export function createMuseDeviceAdapter(options = {}) {
  const transport = options.transport || createWebBluetoothTransport();
  const queueLimit = Number(options.queueLimit || DEFAULT_QUEUE_LIMIT);
  const electrodeIds = (options.channels || MUSE_EEG_CHANNELS.slice(0, 4).map(c => c.id));
  const resolveTimestamp = createPacketTimestampResolver({
    frequency: MUSE_EEG_FREQUENCY,
    samplesPerReading: MUSE_EEG_SAMPLES_PER_READING,
    now: options.now,
  });

  const queues = new Map(electrodeIds.map(id => [id, []]));
  const markers = [];
  let connected = false;
  let unsubscribe = [];
  let deviceDescriptor = null;

  const push = (channelId, samples, packetTimestamp) => {
    const queue = queues.get(channelId);
    if (!queue) return;
    samples.forEach((value, position) => {
      queue.push({ value, timestamp: packetTimestamp + position * (1000 / MUSE_EEG_FREQUENCY) });
    });
    // Bounded queue: drop the oldest samples rather than growing without limit
    // when the sampler runs slower than the device produces data.
    if (queue.length > queueLimit) queue.splice(0, queue.length - queueLimit);
  };

  return {
    async connect(config = {}) {
      deviceDescriptor = await transport.connect({ serviceUuid: MUSE_SERVICE_UUID, ...config });
      // Athena firmware is not supported: fail loudly instead of mis-decoding.
      if (await transport.hasCharacteristic?.(MUSE_CHARACTERISTICS.athenaSensor)) {
        await transport.disconnect?.();
        throw new Error('Muse S Athena (Gen 3) is not supported by this adapter: it multiplexes sensors on 273e0013 with a different packing. Connect a Muse 1/2/S Gen 1-2 headset.');
      }
      const control = await transport.getCharacteristic(MUSE_CHARACTERISTICS.control);
      for (const channel of MUSE_EEG_CHANNELS) {
        if (!electrodeIds.includes(channel.id)) continue;
        const handle = await transport.getCharacteristic(channel.characteristic);
        const stop = await transport.subscribe(handle, view => {
          const packet = parseEegNotification(view);
          push(channel.id, packet.samples, resolveTimestamp(packet.index));
        });
        unsubscribe.push(stop);
      }
      // muse-js start sequence: halt -> preset -> status -> resume ('d').
      await transport.write(control, encodeCommand(MUSE_COMMANDS.halt));
      await transport.write(control, encodeCommand(options.includeAux ? MUSE_COMMANDS.presetWithAux : MUSE_COMMANDS.presetEegOnly));
      await transport.write(control, encodeCommand(MUSE_COMMANDS.status));
      await transport.write(control, encodeCommand(MUSE_COMMANDS.resume));
      connected = true;
      return { ...deviceDescriptor, electrodes: [...electrodeIds], sampleRateHz: MUSE_EEG_FREQUENCY, firmwareFamily: 'classic' };
    },

    async read(channelId) {
      if (!connected) throw new Error('Muse device is not connected');
      const queue = queues.get(channelId);
      if (!queue) throw new Error(`Unknown Muse channel ${channelId}`);
      const sample = queue.shift();
      if (!sample) throw new Error(`No Muse sample buffered for ${channelId}`);
      return { channelId, ...sample };
    },

    // The headset has no hardware marker input; markers are recorded locally with
    // a host timestamp so they can be aligned against the sample stream on export.
    async write(channelId, value) {
      if (!connected) throw new Error('Muse device is not connected');
      if (channelId !== 'marker') throw new Error(`Muse cannot write to channel ${channelId}`);
      const marker = { channelId, value, timestamp: (options.now || Date.now)() };
      markers.push(marker);
      return marker;
    },

    async disconnect() {
      await Promise.all(unsubscribe.map(stop => stop?.().catch?.(() => {})));
      unsubscribe = [];
      connected = false;
      await transport.disconnect?.();
    },

    buffered(channelId) {
      return queues.get(channelId)?.length ?? 0;
    },
    markers,
  };
}

// Re-exported so consumers can build Tauri/plugin transports against the same
// namespace without importing the protocol module separately.
export { MUSE_UUID_NAMESPACE };
