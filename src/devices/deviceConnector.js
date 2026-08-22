export const DEVICE_CONNECTOR_SDK_VERSION = '1.0.0';
export const DEVICE_PERMISSIONS = Object.freeze(['device.connect', 'device.read', 'device.write']);
const PERMISSIONS = new Set(DEVICE_PERMISSIONS);
const TRANSPORTS = new Set(['serial', 'bluetooth', 'usb', 'network', 'simulated']);
const DIRECTIONS = new Set(['input', 'output']);

export function validateDeviceConnector(connector) {
  const errors = [];
  if (!connector || typeof connector !== 'object') return { valid: false, errors: ['Device connector must be an object'] };
  if (connector.sdkVersion !== DEVICE_CONNECTOR_SDK_VERSION) errors.push(`Unsupported device connector SDK version ${connector.sdkVersion || '(missing)'}`);
  if (!connector.connectorId?.match(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)) errors.push('Connector ID must use lowercase dot/dash notation');
  if (!connector.version?.match(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)) errors.push('Connector version must use semantic versioning');
  if (!connector.name?.trim()) errors.push('Connector name is required');
  if (!TRANSPORTS.has(connector.transport)) errors.push(`Unsupported connector transport ${connector.transport}`);
  const permissions = connector.permissions || [];
  if (new Set(permissions).size !== permissions.length) errors.push('Connector permissions must be unique');
  permissions.filter(permission => !PERMISSIONS.has(permission)).forEach(permission => errors.push(`Unsupported connector permission ${permission}`));
  const channelIds = new Set();
  for (const channel of connector.channels || []) {
    if (!channel.id?.match(/^[A-Za-z_][A-Za-z0-9_]*$/) || channelIds.has(channel.id)) errors.push('Device channel IDs must be valid and unique');
    else channelIds.add(channel.id);
    if (!DIRECTIONS.has(channel.direction)) errors.push(`Channel ${channel.id} has invalid direction ${channel.direction}`);
    if (!channel.dataType) errors.push(`Channel ${channel.id} needs a data type`);
  }
  return { valid: errors.length === 0, errors };
}

export function installDeviceConnector(protocol, connector, options = {}) {
  const check = validateDeviceConnector(connector);
  if (!check.valid) throw new Error(`Invalid device connector:\n${check.errors.join('\n')}`);
  const approved = new Set(options.approvedPermissions || []);
  const missing = (connector.permissions || []).filter(permission => !approved.has(permission));
  if (missing.length) throw new Error(`Device connector permissions require approval: ${missing.join(', ')}`);
  if ((protocol.deviceConnectors || []).some(item => item.connectorId === connector.connectorId && item.version === connector.version)) throw new Error(`Device connector ${connector.connectorId}@${connector.version} is already installed`);
  const next = structuredClone(protocol);
  next.deviceConnectors = [...(next.deviceConnectors || []), { ...structuredClone(connector), approvedPermissions: [...approved], installedAt: options.now || new Date().toISOString() }];
  next.audit = { ...(next.audit || {}), updatedAt: options.now || new Date().toISOString() };
  return next;
}

export function uninstallDeviceConnector(protocol, connectorId, version, options = {}) {
  if (!(protocol.deviceConnectors || []).some(item => item.connectorId === connectorId && item.version === version)) return protocol;
  const references = (protocol.graph?.nodes || []).filter(node => node.config?.deviceConnectorId === connectorId && (!node.config?.deviceConnectorVersion || node.config.deviceConnectorVersion === version));
  if (references.length && !options.force) throw new Error(`Device connector is used by ${references.length} node(s)`);
  const next = structuredClone(protocol);
  next.deviceConnectors = next.deviceConnectors.filter(item => item.connectorId !== connectorId || item.version !== version);
  next.audit = { ...(next.audit || {}), updatedAt: options.now || new Date().toISOString() };
  return next;
}

function requirePermission(connector, permission) {
  if (!new Set(connector.approvedPermissions || []).has(permission)) throw new Error(`Device permission ${permission} is not approved`);
}

export class DeviceConnectorSession {
  constructor({ connector, adapter, sessionId, services, onEvent = () => {} }) {
    if (!connector || !adapter || !sessionId || !services?.clock?.now || !services?.idFactory) throw new Error('Device session requires connector, adapter, session ID, clock and ID factory');
    this.connector = structuredClone(connector);
    this.adapter = adapter;
    this.sessionId = sessionId;
    this.services = services;
    this.onEvent = onEvent;
    this.status = 'disconnected';
    this.sequence = 0;
    this.deviceDescriptor = null;
  }

  emit(eventType, payload = {}) {
    const timestamp = this.services.clock.now();
    const event = Object.freeze({
      schemaVersion: '1.0.0',
      eventId: this.services.idFactory('device_event'),
      sequence: ++this.sequence,
      sessionId: this.sessionId,
      eventType,
      timestampIso: timestamp.iso,
      timestampEpochMs: timestamp.epochMs,
      elapsedMonotonicMs: timestamp.monotonicMs,
      connector: { id: this.connector.connectorId, version: this.connector.version, transport: this.connector.transport },
      device: structuredClone(this.deviceDescriptor),
      payload: structuredClone(payload),
    });
    this.onEvent(event);
    return event;
  }

  async connect(config = {}) {
    requirePermission(this.connector, 'device.connect');
    this.status = 'connecting';
    this.emit('device_connection_requested', { config: structuredClone(config) });
    try {
      this.deviceDescriptor = structuredClone(await this.adapter.connect(structuredClone(config)) || {});
      this.status = 'connected';
      return this.emit('device_connected', { channels: (this.connector.channels || []).map(channel => channel.id) });
    } catch (error) {
      this.status = 'failed';
      this.emit('device_connection_failed', { message: error.message || String(error) });
      throw error;
    }
  }

  async read(channelId) {
    if (this.status !== 'connected') throw new Error('Device is not connected');
    requirePermission(this.connector, 'device.read');
    const channel = (this.connector.channels || []).find(item => item.id === channelId && item.direction === 'input');
    if (!channel) throw new Error(`Unknown input channel ${channelId}`);
    try {
      const sample = await this.adapter.read(channelId);
      return this.emit('device_sample_received', { channelId, value: structuredClone(sample?.value ?? sample), deviceTimestamp: sample?.timestamp ?? null, unit: channel.unit || null, dataType: channel.dataType });
    } catch (error) {
      this.emit('device_read_failed', { channelId, message: error.message || String(error) });
      throw error;
    }
  }

  async write(channelId, value) {
    if (this.status !== 'connected') throw new Error('Device is not connected');
    requirePermission(this.connector, 'device.write');
    const channel = (this.connector.channels || []).find(item => item.id === channelId && item.direction === 'output');
    if (!channel) throw new Error(`Unknown output channel ${channelId}`);
    try {
      await this.adapter.write(channelId, structuredClone(value));
      return this.emit('device_marker_sent', { channelId, value: structuredClone(value), unit: channel.unit || null, dataType: channel.dataType });
    } catch (error) {
      this.emit('device_write_failed', { channelId, value: structuredClone(value), message: error.message || String(error) });
      throw error;
    }
  }

  async disconnect(reason = 'operator') {
    try { await this.adapter.disconnect?.(); }
    finally { this.status = 'disconnected'; }
    return this.emit('device_disconnected', { reason });
  }

  async recover(config = {}, options = {}) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
    this.emit('device_recovery_started', { maxAttempts });
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.adapter.disconnect?.();
        this.status = 'disconnected';
        await this.connect(config);
        return this.emit('device_recovered', { attempt });
      } catch (error) {
        this.emit('device_recovery_attempt_failed', { attempt, message: error.message || String(error) });
      }
    }
    this.status = 'failed';
    const failed = this.emit('device_recovery_failed', { maxAttempts });
    throw Object.assign(new Error(`Device recovery failed after ${maxAttempts} attempts`), { event: failed });
  }

  provenance() {
    return { connector: { id: this.connector.connectorId, version: this.connector.version, transport: this.connector.transport }, device: structuredClone(this.deviceDescriptor), status: this.status, eventSequence: this.sequence };
  }
}
