// Web Bluetooth transport for device connectors.
//
// The transport is the only part of a device adapter that touches platform APIs,
// so it is kept behind a small interface:
//
//   connect(options) -> deviceDescriptor
//   getCharacteristic(uuid) -> handle
//   subscribe(handle, handler)   handler receives a DataView
//   write(handle, bytes)
//   disconnect()
//
// Adapters take a transport by injection, which keeps protocol decoding testable
// in Node and leaves room for a Tauri backend: the desktop webview (WebView2 on
// Windows) does not expose Web Bluetooth, so `supportsWebBluetooth()` is false
// there and a native plugin transport can be supplied instead.

export function supportsWebBluetooth() {
  return typeof navigator !== 'undefined' && Boolean(navigator?.bluetooth?.requestDevice);
}

export function webBluetoothUnavailableMessage() {
  return 'Web Bluetooth is unavailable in this environment. Use a Chromium-based browser in the hosted/web target, or supply a native Tauri BLE transport to the adapter.';
}

export function createWebBluetoothTransport() {
  let device = null;
  let server = null;
  let service = null;

  return {
    async connect({ serviceUuid, filters = [], optionalServices = [] } = {}) {
      if (!supportsWebBluetooth()) throw new Error(webBluetoothUnavailableMessage());
      // requestDevice must be called from a user gesture.
      device = await navigator.bluetooth.requestDevice({
        filters: filters.length ? filters : [{ services: [serviceUuid] }],
        optionalServices: [serviceUuid, ...optionalServices],
      });
      server = await device.gatt.connect();
      service = await server.getPrimaryService(serviceUuid);
      return {
        deviceId: device.id || null,
        name: device.name || null,
        manufacturer: 'InteraXon',
        firmware: null,
      };
    },

    async getCharacteristic(uuid) {
      if (!service) throw new Error('Bluetooth transport is not connected');
      return service.getCharacteristic(uuid);
    },

    async hasCharacteristic(uuid) {
      if (!service) throw new Error('Bluetooth transport is not connected');
      try { await service.getCharacteristic(uuid); return true; } catch { return false; }
    },

    async subscribe(handle, handler) {
      const listener = event => handler(event.target.value);
      handle.addEventListener('characteristicvaluechanged', listener);
      await handle.startNotifications();
      return () => {
        handle.removeEventListener('characteristicvaluechanged', listener);
        return handle.stopNotifications?.();
      };
    },

    async write(handle, bytes) {
      await handle.writeValue(bytes);
    },

    async disconnect() {
      try { server?.disconnect?.(); } finally { device = null; server = null; service = null; }
    },
  };
}
