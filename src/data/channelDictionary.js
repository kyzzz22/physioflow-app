// D4: Channel-level data dictionary (データ辞書連携).
// Extracts the time-series channel manifest (dataType/unit/sampleRate) declared by a
// protocol's device connectors and renders it as a channel dictionary that is:
//   - bundled into graph session exports as channel_dictionary.json
//   - pushed to the BioDB experiment registry via POST /experiment/<id>/dictionary
//
// The dictionary key is the channel id (unique per connector); connector provenance is
// kept alongside so a channel can be traced back to its device and transport.

import { isGraphProtocol, protocolIdOf, protocolNameOf, protocolVersionOf } from '../core/protocolSelectors.js';

export const CHANNEL_DICTIONARY_CONTRACT_VERSION = '1.0.0';

/** All device connectors referenced by a protocol (V2 Graph nodes + legacy V1 list). */
export function deviceConnectorsOf(protocol) {
  if (!protocol) return [];
  const registry = protocol.deviceConnectors || [];
  if (!isGraphProtocol(protocol)) return registry;
  // V2 Graph: device nodes are wired via node.config.deviceConnectorId; when no device
  // node exists yet, fall back to every installed connector in the registry.
  const nodeRefs = (protocol.graph?.nodes || [])
    .filter(node => node.config?.deviceConnectorId)
    .map(node => ({ id: node.config.deviceConnectorId, version: node.config.deviceConnectorVersion }))
    .filter(ref => ref.id);
  const wired = nodeRefs.length
    ? nodeRefs.map(ref => registry.find(item => item.connectorId === ref.id && (!ref.version || item.version === ref.version))).filter(Boolean)
    : [];
  return wired.length ? wired : registry;
}

/**
 * Channel-level data dictionary for a protocol.
 * Returns { contractVersion, protocol { id, name, version }, connectors, channels,
 *           inputChannels, outputChannels }.
 * `channels` maps channel id -> { connectorId, connectorVersion, label, dataType, unit,
 * sampleRateHz, direction } and is directly compatible with the BioDB experiment
 * dictionary shape ({ channelName -> definition }).
 */
export function channelDataDictionary(protocol) {
  const connectors = deviceConnectorsOf(protocol);
  const connectorMeta = {};
  const channels = {};
  const inputChannels = [];
  const outputChannels = [];

  for (const connector of connectors) {
    const connectorId = connector.connectorId || connector.id || '';
    if (!connectorId) continue;
    connectorMeta[connectorId] = {
      connectorId,
      version: connector.version || '',
      name: connector.name || connector.connectorName || '',
      transport: connector.transport || '',
      description: connector.description || '',
    };
    for (const channel of connector.channels || []) {
      const id = channel.id || channel.channelId;
      if (!id) continue;
      const direction = channel.direction || 'input';
      const definition = {
        connectorId,
        connectorVersion: connector.version || '',
        label: channel.label || channel.name || id,
        dataType: channel.dataType || 'number',
        unit: channel.unit ?? null,
        sampleRateHz: channel.sampleRateHz ?? null,
        direction,
      };
      channels[id] = definition;
      (direction === 'output' ? outputChannels : inputChannels).push(id);
    }
  }

  return {
    contractVersion: CHANNEL_DICTIONARY_CONTRACT_VERSION,
    protocol: {
      id: protocolIdOf(protocol),
      name: protocolNameOf(protocol),
      version: protocolVersionOf(protocol),
    },
    connectors: connectorMeta,
    channels,
    inputChannels,
    outputChannels,
  };
}

/**
 * BioDB-compatible dictionary payload for the experiment registry.
 * Only input (time-series) channels are included, keyed by channel id with the
 * definition fields the registry expects: { label, unit, type, sampleRateHz, direction }.
 * Returns null when the protocol declares no input channels.
 */
export function dictionaryPayload(protocol) {
  const dict = channelDataDictionary(protocol);
  const input = Object.fromEntries(
    Object.entries(dict.channels).filter(([, def]) => def.direction === 'input')
  );
  if (!Object.keys(input).length) return null;
  return {
    dictionary: Object.fromEntries(Object.entries(input).map(([id, def]) => [id, {
      label: def.label,
      unit: def.unit,
      type: def.dataType,
      sampleRateHz: def.sampleRateHz,
      direction: def.direction,
      connectorId: def.connectorId,
      connectorVersion: def.connectorVersion,
    }])),
  };
}
