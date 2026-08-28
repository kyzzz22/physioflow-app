// Muse EEG headset wire protocol — Classic firmware (Muse 1 / Muse 2 / Muse S Gen 1-2).
//
// Decoding mirrors the Web Bluetooth reference implementation muse-js
// (urish/muse-js, MIT): 12-bit big-endian packed samples scaled to microvolts by
// `0.48828125 * (raw - 0x800)`. UUIDs, sampling rates and packet geometry are
// cross-checked against muse-rs, which documents the same 12-bit ADC centred at
// 2048 with a 0.48828125 uV/LSB scale.
//
// Athena firmware (Muse S Gen 3) instead multiplexes every sensor on a single
// characteristic (273e0013) using tag-based subpackets with a different
// bit-packing (14-bit LSB-first) and an undocumented double `dc001` handshake.
// That path is deliberately NOT implemented — the connector detects the
// characteristic and fails with an explicit message rather than decoding bytes
// it cannot verify.

export const MUSE_SERVICE_UUID = 0xfe8d;
export const MUSE_UUID_NAMESPACE = '-4c4d-454d-96be-f03bac821358';

export const MUSE_CHARACTERISTICS = Object.freeze({
  control: `273e0001${MUSE_UUID_NAMESPACE}`,
  telemetry: `273e000b${MUSE_UUID_NAMESPACE}`,
  gyroscope: `273e0009${MUSE_UUID_NAMESPACE}`,
  accelerometer: `273e000a${MUSE_UUID_NAMESPACE}`,
  // Athena-only universal sensor characteristic; its presence identifies Gen 3.
  athenaSensor: `273e0013${MUSE_UUID_NAMESPACE}`,
});

// EEG electrode order matches the characteristic suffixes 0003..0007.
export const MUSE_EEG_CHANNELS = Object.freeze([
  { id: 'TP9', characteristic: `273e0003${MUSE_UUID_NAMESPACE}` },
  { id: 'AF7', characteristic: `273e0004${MUSE_UUID_NAMESPACE}` },
  { id: 'AF8', characteristic: `273e0005${MUSE_UUID_NAMESPACE}` },
  { id: 'TP10', characteristic: `273e0006${MUSE_UUID_NAMESPACE}` },
  { id: 'AUX', characteristic: `273e0007${MUSE_UUID_NAMESPACE}` },
]);

export const MUSE_PPG_CHANNELS = Object.freeze([
  { id: 'ambient', characteristic: `273e000f${MUSE_UUID_NAMESPACE}` },
  { id: 'infrared', characteristic: `273e0010${MUSE_UUID_NAMESPACE}` },
  { id: 'red', characteristic: `273e0011${MUSE_UUID_NAMESPACE}` },
]);

export const MUSE_EEG_FREQUENCY = 256;
export const MUSE_EEG_SAMPLES_PER_READING = 12;
export const MUSE_PPG_FREQUENCY = 64;
export const MUSE_PPG_SAMPLES_PER_READING = 6;
export const MUSE_IMU_FREQUENCY = 52;
export const MUSE_IMU_SAMPLES_PER_READING = 3;

// microvolts per raw LSB, with the 12-bit ADC centred at 0x800.
export const EEG_SCALE_UV = 0.48828125;
export const EEG_ADC_MIDPOINT = 0x800;
export const ACCELEROMETER_SCALE_G = 0.0000610352;
export const GYROSCOPE_SCALE_DPS = 0.0074768;

/** Unpack big-endian 12-bit samples: every 3 bytes carry 2 samples. */
export function decodeUnsigned12BitData(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (i % 3 === 0) out.push(((bytes[i] << 4) | (bytes[i + 1] >> 4)) & 0x0fff);
    else { out.push(((bytes[i] & 0x0f) << 8) | bytes[i + 1]); i += 1; }
  }
  return out;
}

/** Unpack big-endian 24-bit samples: every 3 bytes carry 1 sample. */
export function decodeUnsigned24BitData(bytes) {
  const out = [];
  for (let i = 0; i + 2 < bytes.length; i += 3) out.push((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]);
  return out;
}

/** EEG payload (18 bytes) -> 12 samples in microvolts. */
export function decodeEegSamples(bytes) {
  return decodeUnsigned12BitData(bytes).map(raw => EEG_SCALE_UV * (raw - EEG_ADC_MIDPOINT));
}

/** PPG payload (18 bytes) -> 6 raw 24-bit optical samples. */
export function decodePpgSamples(bytes) {
  return decodeUnsigned24BitData(bytes);
}

/**
 * Split one EEG notification into its packet index and decoded samples.
 * Layout: uint16 big-endian packet index, then 12 packed 12-bit samples.
 */
export function parseEegNotification(view) {
  return { index: view.getUint16(0), samples: decodeEegSamples(new Uint8Array(view.buffer, view.byteOffset + 2, view.byteLength - 2)) };
}

/** Split one PPG notification into its packet index and raw samples. */
export function parsePpgNotification(view) {
  return { index: view.getUint16(0), samples: decodePpgSamples(new Uint8Array(view.buffer, view.byteOffset + 2, view.byteLength - 2)) };
}

/**
 * Telemetry notification -> { sequenceId, batteryLevel, fuelGaugeVoltage, temperature }.
 * batteryLevel is reported by the device as a raw value that muse-js divides by 512.
 */
export function parseTelemetry(view) {
  return {
    sequenceId: view.getUint16(0),
    batteryLevel: view.getUint16(2) / 512,
    fuelGaugeVoltage: view.getUint16(4) * 2.2,
    temperature: view.getUint16(8),
  };
}

/** IMU notification (accelerometer or gyroscope) -> { sequenceId, samples: [{x,y,z} x3] }. */
export function parseImu(view, scale) {
  const sample = offset => ({ x: scale * view.getInt16(offset), y: scale * view.getInt16(offset + 2), z: scale * view.getInt16(offset + 4) });
  return { sequenceId: view.getUint16(0), samples: [sample(2), sample(8), sample(14)] };
}

export const parseAccelerometer = view => parseImu(view, ACCELEROMETER_SCALE_G);
export const parseGyroscope = view => parseImu(view, GYROSCOPE_SCALE_DPS);

/**
 * Encode a control command. The headset expects a length-prefixed frame:
 * byte 0 = payload length (command + trailing newline), then ASCII, then '\n'.
 */
export function encodeCommand(command) {
  const body = new TextEncoder().encode(`X${command}\n`);
  body[0] = body.length - 1;
  return body;
}

/** Decode a control notification: same length-prefix framing, UTF-8 payload. */
export function decodeResponse(bytes) {
  if (!bytes.length) return '';
  const end = Math.min(1 + bytes[0], bytes.length);
  return new TextDecoder().decode(bytes.subarray(1, end));
}

// Muse control commands used by the adapter.
export const MUSE_COMMANDS = Object.freeze({
  version: 'v1',
  status: 's',
  halt: 'h',
  resume: 'd',
  presetEegOnly: 'p21',
  presetWithAux: 'p20',
  presetWithPpg: 'p50',
});
