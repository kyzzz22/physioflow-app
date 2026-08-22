import { DEVICE_CONNECTOR_SDK_VERSION } from './deviceConnector.js';

export function exampleSimulatedConnector() {
  return {
    sdkVersion: DEVICE_CONNECTOR_SDK_VERSION,
    connectorId: 'org.physioflow.simulated-sensor',
    version: '1.0.0',
    name: 'Simulated Physiology Sensor',
    transport: 'simulated',
    permissions: ['device.connect', 'device.read', 'device.write'],
    channels: [
      { id: 'signal', direction: 'input', dataType: 'number', unit: 'a.u.', sampleRateHz: 100 },
      { id: 'marker', direction: 'output', dataType: 'string', unit: null },
    ],
  };
}

export function createSimulatedDeviceAdapter(options = {}) {
  let connected = false;
  let sampleIndex = 0;
  const markers = [];
  return {
    async connect() { if (options.failConnect?.()) throw new Error('Simulated connection failure'); connected = true; return { deviceId: options.deviceId || 'SIM-001', manufacturer: 'PhysioFlow', firmware: '1.0.0' }; },
    async read(channelId) { if (!connected) throw new Error('Simulated device disconnected'); return { value: Number(options.samples?.[sampleIndex++] ?? sampleIndex), timestamp: options.clock?.() ?? sampleIndex * 10, channelId }; },
    async write(channelId, value) { if (!connected) throw new Error('Simulated device disconnected'); markers.push({ channelId, value }); },
    async disconnect() { connected = false; },
    markers,
  };
}
