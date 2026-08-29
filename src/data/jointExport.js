// D6: Joint export / archiving (統合書き出し).
// Merges the PF session package (protocol + events + device events, produced by
// buildGraphSessionFiles / bundle) with a BioDB export envelope (time series +
// events + experiment metadata, from POST /sensor/data/export) into one archive.
//
// Layout of the merged package:
//   joint_manifest.json      provenance, time windows, counts and per-section status
//   <PF session files>       kept at the top level, unchanged
//   biodb/sensor_data.csv    columnar time series flattened to rows
//   biodb/sensor_data.json   the same payload as returned by BioDB
//   biodb/events.json        events filtered by participant + window
//   biodb/experiment.json    experiment registry entry (incl. the channel dictionary)
//   joint_data_dictionary.json  field descriptions for the merged package

import { channelDataDictionary } from './channelDictionary.js';

export const JOINT_EXPORT_CONTRACT_VERSION = '1.0.0';

const csvValue = value => {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csv = (rows, columns) => `${columns.join(',')}\n${rows.map(row => columns.map(column => csvValue(row[column])).join(',')).join('\n')}${rows.length ? '\n' : ''}`;

/**
 * BioDB returns columnar data: { time: [iso...], channel: [values...] }.
 * Flatten to row objects; missing samples stay null so the CSV stays rectangular.
 */
export function sensorRowsToObjects(sensor) {
  const times = sensor?.time || [];
  const channels = Object.keys(sensor || {}).filter(key => key !== 'time');
  return times.map((time, index) => {
    const row = { time };
    for (const channel of channels) row[channel] = sensor[channel]?.[index] ?? null;
    return row;
  });
}

/** Column list of a sensor payload with `time` first. */
export function sensorColumns(sensor) {
  return ['time', ...Object.keys(sensor || {}).filter(key => key !== 'time').sort()];
}

/** Sensor payload -> CSV text (empty when BioDB returned no samples). */
export function sensorToCsv(sensor) {
  const columns = sensorColumns(sensor);
  return csv(sensorRowsToObjects(sensor), columns);
}

/** Channels that PF pushed for this session, used as the BioDB read-back selector. */
export function channelsForExport(protocol, deviceEvents = []) {
  const declared = channelDataDictionary(protocol).inputChannels;
  if (declared.length) return declared;
  // Fall back to whatever the device events actually carried.
  const seen = new Set();
  for (const event of deviceEvents) {
    const payload = event?.payload ?? event?.payload_json;
    if (!payload || typeof payload !== 'object') continue;
    for (const key of Object.keys(payload)) if (key !== 'time' && typeof payload[key] === 'number') seen.add(key);
  }
  return [...seen];
}

/**
 * Merge a PF session package with a BioDB export envelope.
 *
 * sessionFiles: { [filename]: string } as produced by buildGraphSessionFiles/bundle.
 * biodb:        { sensor, events, experiment } from exportBioDBData; may be null
 *               when the BioDB leg failed, in which case the PF leg is still archived
 *               and the manifest records why.
 * meta:         { sessionId, participantId, experimentId, startTime, endTime,
 *                 baseUrl, protocol, channels, generatedAt, biodbError }
 */
export function buildJointExportFiles({ sessionFiles = {}, biodb = null, meta = {} }) {
  const sensor = biodb?.sensor || null;
  const events = biodb?.events || null;
  const experiment = biodb?.experiment || null;
  const times = sensor?.time || [];
  const columns = sensorColumns(sensor).filter(key => key !== 'time');

  const manifest = {
    contractVersion: JOINT_EXPORT_CONTRACT_VERSION,
    generatedAt: meta.generatedAt || new Date().toISOString(),
    sessionId: meta.sessionId || null,
    participantId: meta.participantId || null,
    experimentId: meta.experimentId || null,
    window: {
      // PF timestamps and BioDB timestamps are both ISO-8601, but the BioDB leg is
      // authoritative for the sensor window because it is what the server accepted.
      requestedStart: meta.startTime || null,
      requestedEnd: meta.endTime || null,
      sensorStart: times.length ? times[0] : null,
      sensorEnd: times.length ? times[times.length - 1] : null,
    },
    sources: {
      pf: {
        included: Object.keys(sessionFiles).length > 0,
        files: Object.keys(sessionFiles).sort(),
      },
      biodb: {
        baseUrl: meta.baseUrl || null,
        included: Boolean(biodb),
        error: meta.biodbError || null,
        channels: meta.channels || [],
        sensorPoints: times.length,
        sensorColumns: columns,
        events: Array.isArray(events) ? events.length : null,
        experiment: experiment ? (experiment.experiment_id || experiment.id || null) : null,
        dictionaryIncluded: Boolean(experiment?.dictionary),
      },
    },
    warnings: [],
  };

  if (!biodb) {
    manifest.warnings.push(manifest.sources.biodb.error
      ? `BioDB leg failed: ${manifest.sources.biodb.error}. The PF session package is complete on its own.`
      : 'No BioDB export was attached; this package contains the PF session only.');
  } else if (!times.length) {
    // BioDB writes land in VictoriaMetrics asynchronously: a session pushed seconds
    // ago can legitimately read back empty. Say so instead of implying data loss.
    manifest.warnings.push('BioDB returned no sensor samples for this participant and window. '
      + 'If the session was pushed moments ago, wait a few seconds and export again — VictoriaMetrics makes new samples queryable asynchronously.');
  }
  if (biodb && !experiment) {
    manifest.warnings.push('No experiment metadata was returned; the session may not be linked to a registered experiment.');
  }

  const files = {
    'joint_manifest.json': JSON.stringify(manifest, null, 2),
    'joint_data_dictionary.json': JSON.stringify(jointDataDictionary(), null, 2),
    ...sessionFiles,
  };
  if (biodb) {
    files['biodb/sensor_data.csv'] = sensorToCsv(sensor);
    files['biodb/sensor_data.json'] = JSON.stringify(sensor ?? { time: [] }, null, 2);
    if (events) files['biodb/events.json'] = JSON.stringify(events, null, 2);
    if (experiment) files['biodb/experiment.json'] = JSON.stringify(experiment, null, 2);
  }
  return { files, manifest };
}

/** Field descriptions for the files this module adds to the package. */
export function jointDataDictionary() {
  return {
    contractVersion: JOINT_EXPORT_CONTRACT_VERSION,
    tables: {
      joint_manifest: {
        primaryKey: 'n/a (single object)',
        description: 'Provenance of the merged package: which legs succeeded, the requested and actual time windows, and record counts.',
        columns: ['contractVersion', 'generatedAt', 'sessionId', 'participantId', 'experimentId', 'window', 'sources', 'warnings'],
      },
      'biodb/sensor_data': {
        primaryKey: 'time (UTC ISO-8601)',
        description: 'BioDB time series flattened from the columnar read-back. Missing samples are empty cells, not zeros, so gaps stay visible.',
        columns: ['time', '<channel>', '...'],
      },
      'biodb/events': {
        primaryKey: 'event id',
        description: 'Events recorded in BioDB for this participant within the requested window (as returned by /sensor/data/export).',
      },
      'biodb/experiment': {
        primaryKey: 'experiment_id',
        description: 'Experiment registry entry, including the channel dictionary attached by D4.',
      },
    },
    notes: [
      'PF session files are stored at the top level unchanged, so an existing analysis pipeline keeps working.',
      'BioDB timestamps are UTC; PF event timestamps carry their own offset. Compare on instants, not on local strings.',
      'When several experiments share a channel name, BioDB suffixes the column with @<experiment_id>.',
    ],
  };
}
