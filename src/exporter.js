import { assessSession } from './integrity.js';
import { uid } from './domain.js';

const esc = value => `"${String(value ?? '').replaceAll('"', '""').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`;
const csv = (headers, rows) => '\uFEFF' + [headers, ...rows].map(row => row.map(esc).join(',')).join('\r\n') + '\r\n';
const allSteps = protocol => protocol.blocks.flatMap(block => block.trials.flatMap(trial => trial.steps));
const occurrenceKey = event => event.step_id;
const resolvedStepMap=protocol=>{const stimuli=new Map((protocol.stimuli||[]).map(item=>[item.stimulus_id,item]));return new Map(allSteps(protocol).map(item=>{const shared=stimuli.get(item.stimulus_id),usesShared=!item.source_url&&!item.asset_id;return[item.step_id,{...item,source_mode:usesShared?shared?.source_mode||item.source_mode:item.source_mode}]}))};

export function windows(events, protocol) {
  const steps = resolvedStepMap(protocol);
  const ordered = [...events].sort((left, right) => left.elapsed_monotonic_ms - right.elapsed_monotonic_ms);
  const open = new Map();
  const pairs = new Map();
  for (const event of ordered) {
    const step = steps.get(event.step_id);
    const mediaWindow = ['video','audio'].includes(step?.type)&&step?.source_mode!=='youtube';
    const startType = mediaWindow ? 'media_play_started' : 'step_entered';
    const endTypes = mediaWindow ? ['media_ended','step_skipped','step_retried'] : ['step_completed','step_skipped','step_retried'];
    const key = occurrenceKey(event);
    if (event.event_type === startType) {
      const queue = open.get(key) || [];
      queue.push(event);
      open.set(key, queue);
    }
    if (endTypes.includes(event.event_type)) {
      const queue = open.get(key) || [];
      const start = queue.shift();
      if (start) pairs.set(start.event_id, event);
    }
  }
  const markers = ordered.filter(event => event.event_type === 'manual_marker').sort((a,b) => a.elapsed_monotonic_ms - b.elapsed_monotonic_ms);
  const intervalEnds = new Map(ordered.filter(event=>event.event_type==='marker_interval_ended').map(event=>[event.metadata?.marker_id,event]));
  const markerIntervals = ordered.filter(event=>event.event_type==='marker_interval_started').map(start=>({start,end:intervalEnds.get(start.metadata?.marker_id)})).filter(iv=>iv.start).sort((a,b) => a.start.elapsed_monotonic_ms - b.start.elapsed_monotonic_ms);
  const pauses = ordered.filter(event => event.event_type === 'session_paused').sort((a,b) => a.elapsed_monotonic_ms - b.elapsed_monotonic_ms);
  // Helper: count items in sorted array with elapsed_ms in [lo, hi] using two-pointer-like scan
  function countInRange(sorted, lo, hi, extract = x => x) {
    let c = 0;
    for (const item of sorted) { const t = extract(item); if (t >= lo && t <= hi) c++; if (t > hi) break; }
    return c;
  }
  function itemsInRange(sorted, lo, hi, extract = x => x) {
    const result = [];
    for (const item of sorted) { const t = extract(item); if (t >= lo && t <= hi) result.push(item); if (t > hi) break; }
    return result;
  }
  return ordered.filter(event => {
    const step=steps.get(event.step_id),startType=['video','audio'].includes(step?.type)&&step?.source_mode!=='youtube'?'media_play_started':'step_entered';
    return event.event_type===startType&&step?.is_analysis_window;
  }).map(start => {
    const step = steps.get(start.step_id);
    const end = pairs.get(start.event_id);
    const lo = start.elapsed_monotonic_ms;
    const hi = end?.elapsed_monotonic_ms ?? Infinity;
    const overlappingMarkers = itemsInRange(markers, lo, hi, m => m.elapsed_monotonic_ms).map(marker=>marker.metadata?.marker_type);
    itemsInRange(markerIntervals, lo, hi, iv => iv.start.elapsed_monotonic_ms).forEach(interval=>overlappingMarkers.push(`${interval.start.metadata?.marker_type}:interval`));
    const pauseCount = countInRange(pauses, lo, hi, p => p.elapsed_monotonic_ms);
    const youtubeUnverified=step.source_mode==='youtube';
    const validity = !end || end.event_type==='step_skipped' ? 'invalid' : pauseCount || end.event_type==='step_retried' || youtubeUnverified ? 'attention' : 'valid';
    return {
      window_id: uid('window'), session_id:start.session_id, participant_id:start.participant_id,
      block_id:start.block_id, trial_id:start.trial_id, step_id:start.step_id, condition:start.condition,
      analysis_label:step.analysis_label || step.role, start_event_id:start.event_id, end_event_id:end?.event_id || '',
      start_epoch_ms:start.timestamp_epoch_ms, end_epoch_ms:end?.timestamp_epoch_ms || '',
      expected_duration_ms:step.planned_duration_ms || '', duration_ms:end ? end.elapsed_monotonic_ms - start.elapsed_monotonic_ms : '',
      pause_count:pauseCount, validity_status:validity,
      invalid_reason:!end ? 'missing_end_event' : end.event_type==='step_skipped' ? 'step_skipped' : end.event_type==='step_retried' ? 'step_retried' : pauseCount ? 'contains_pause' : youtubeUnverified ? 'youtube_playback_unverified' : '',
      overlapping_markers:[...new Set(overlappingMarkers)].join('|'),
    };
  });
}

export function stimulusManifest(protocol) {
  const library = new Map((protocol.stimuli || []).map(item => [item.stimulus_id, item]));
  const fromSteps = allSteps(protocol).filter(item => ['video', 'audio', 'image'].includes(item.type)).map(item => {
    const shared = library.get(item.stimulus_id) || {};
    return {
      stimulus_id:item.stimulus_id || item.asset_id || `step_resource_${item.step_id}`,
      step_id:item.step_id, name:item.name || shared.name, type:item.type || shared.type,
      source_mode:item.source_url||item.asset_id ? item.source_mode : shared.source_mode || item.source_mode || (item.asset_id ? 'upload' : 'url'), source_url:item.source_url || shared.source_url || '',
      asset_id:item.asset_id || shared.asset_id || '', file_name:item.file_name || shared.file_name || '',
      mime_type:item.mime_type || shared.mime_type || '', file_size:item.file_size || shared.file_size || '', checksum:item.checksum || shared.checksum || '',
      metadata:{ ...(shared.metadata || {}), volume:item.volume, loop:item.loop, muted:item.muted },
    };
  });
  const used = new Set(fromSteps.map(item => item.stimulus_id));
  const unusedLibrary = [...library.values()].filter(item => !used.has(item.stimulus_id)).map(item => ({
    ...item, step_id:'', source_mode:'library', source_url:item.source_url || '', asset_id:item.asset_id || '',
    mime_type:item.mime_type || '', file_size:item.file_size || '', metadata:item.metadata || {},
  }));
  return [...fromSteps, ...unusedLibrary];
}

export function bundle(session, protocol, events, responses = []) {
  const windowHeaders = ['window_id','session_id','participant_id','block_id','trial_id','step_id','condition','analysis_label','start_event_id','end_event_id','start_epoch_ms','end_epoch_ms','expected_duration_ms','duration_ms','pause_count','validity_status','invalid_reason','overlapping_markers'];
  const eventHeaders = ['schema_version','event_id','session_id','participant_id','protocol_id','protocol_version','block_id','block_order','block_repeat','trial_id','trial_order','trial_repeat','step_id','step_order','node_id','condition','event_type','event_status','timestamp_iso','timestamp_epoch_ms','elapsed_monotonic_ms','timestamp_epoch_fallback','stimulus_id','metadata_json'];
  const responseHeaders = ['response_id','session_id','participant_id','block_id','trial_id','step_id','condition','questionnaire_id','question_id','question_type','value','option_label','response_key','reaction_time_ms','submitted_epoch_ms'];
  const manifestHeaders = ['stimulus_id','step_id','name','type','source_mode','source_url','asset_id','file_name','mime_type','file_size','checksum','metadata_json'];
  const analysisWindows = windows(events, protocol);
  const manifest = stimulusManifest(protocol);
  const report = assessSession({ session, protocol, events, responses, runtime:session.runtime_snapshot });
  const cleanSession = Object.fromEntries(Object.entries(session).filter(([key]) => !['events','responses','protocol_snapshot'].includes(key)));
  cleanSession.integrity = report;
  const exportManifest = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    app_version: protocol.app_version || '',
    session_id: session.session_id || '',
    participant_id: session.participant_id || '',
    protocol_id: protocol.protocol_id || '',
    protocol_version: protocol.version || '',
    protocol_hash: session.protocol_hash || protocol.config_hash || '',
    counts: {
      events: events.length,
      responses: responses.length,
      analysis_windows: analysisWindows.length,
      stimuli: manifest.length,
    },
    files: {
      'README.txt': 'Human-readable description of the export package.',
      'export_manifest.json': 'Machine-readable package manifest and record counts.',
      'session.json': 'Session metadata and integrity summary without raw event arrays.',
      'protocol.json': 'Protocol snapshot used by this session.',
      'events.csv': 'Append-only raw event log.',
      'responses.csv': 'Questionnaire answers and Response-node choices, one row per submitted answer.',
      'analysis_windows.csv': 'Derived windows for steps marked as analysis windows.',
      'stimulus_manifest.csv': 'Media resources referenced by the protocol.',
      'integrity_report.json': 'Automated validity checks and warnings.',
      'data_dictionary.csv': 'CSV field descriptions.',
    },
  };
  const readme = [
    'PhysioFlow session export',
    '',
    `Session: ${session.session_id || ''}`,
    `Participant: ${session.participant_id || ''}`,
    `Protocol: ${protocol.name || protocol.protocol_id || ''}`,
    `Generated: ${exportManifest.generated_at}`,
    '',
    'Recommended analysis entry points:',
    '1. Use events.csv for raw timing and reconstruction.',
    '2. Use analysis_windows.csv for physiology window extraction.',
    '3. Use responses.csv for questionnaire outcomes, quick Response-node choices, reaction times, and branch variables.',
    '4. Check integrity_report.json before excluding or accepting a session.',
    '5. For external questionnaires, join answers from the external service by participant/session labels or appended URL parameters, and use external_questionnaire_* events for timing.',
    '',
    'Timing columns:',
    '- timestamp_epoch_ms: high-resolution Unix epoch milliseconds for external-device alignment.',
    '- elapsed_monotonic_ms: monotonic milliseconds since session start for within-session intervals.',
    '',
    'See data_dictionary.csv for field-level definitions.',
    '',
  ].join('\n');
  const dataDictionary = [
    ['export_manifest.json','schema_version','Manifest schema version for the export package.'],
    ['export_manifest.json','counts','Record counts for quick completeness checks.'],
    ['session.json','integrity','Integrity report embedded into the session summary.'],
    ['events.csv','schema_version','Log format version — currently 1.2.0.'],
    ['events.csv','event_id','Unique event identifier.'],
    ['events.csv','session_id','Session identifier shared by all rows in this run.'],
    ['events.csv','participant_id','Researcher-entered participant code. Use anonymous IDs.'],
    ['events.csv','protocol_id','Protocol identifier.'],
    ['events.csv','protocol_version','Protocol version number.'],
    ['events.csv','block_id','Block identifier from protocol.json.'],
    ['events.csv','block_order','Zero-based block order in the resolved runtime sequence.'],
    ['events.csv','block_repeat','One-based repetition index of the block.'],
    ['events.csv','trial_id','Trial identifier from protocol.json.'],
    ['events.csv','trial_order','Zero-based trial order after fixed/random/latin-square/manual resolution.'],
    ['events.csv','trial_repeat','One-based repetition index of the trial.'],
    ['events.csv','step_id','Step identifier from protocol.json.'],
    ['events.csv','step_order','Zero-based step order inside the compiled trial path.'],
    ['events.csv','node_id','Flow graph node ID; useful when a branch revisits the same step.'],
    ['events.csv','condition','Trial condition label.'],
    ['events.csv','event_type','Event name such as step_entered, step_completed, media_play_started, or manual_marker.'],
    ['events.csv','event_status','ok, warning, or error status emitted by the runtime.'],
    ['events.csv','timestamp_iso','Wall-clock ISO 8601 with microsecond precision.'],
    ['events.csv','timestamp_epoch_ms','High-resolution Unix epoch milliseconds. Use for aligning with physiological devices.'],
    ['events.csv','elapsed_monotonic_ms','Monotonic elapsed milliseconds since session start. Use for intervals.'],
    ['events.csv','timestamp_epoch_fallback','Standard Date.now() integer epoch milliseconds.'],
    ['events.csv','stimulus_id','Stimulus/resource identifier when the event is tied to media.'],
    ['events.csv','metadata_json','JSON payload for event-specific details.'],
    ['events.csv','manual_event_confirmed metadata','For manual_event nodes, metadata_json contains confirmation_label, operator_note, and note_required.'],
    ['events.csv','device_check_completed metadata','For device_check nodes, metadata_json contains checks[], all_checked, required_all, and operator_note.'],
    ['events.csv','external_questionnaire_opened metadata','For external questionnaire nodes, metadata_json contains external_form_url, resolved_form_url, appended_context, and embedded/click open mode details.'],
    ['events.csv','external_questionnaire_confirmed metadata','For external questionnaire nodes, metadata_json contains external_form_url, resolved_form_url, opened, confirmed, and appended_context flags. Answers remain in the external form service.'],
    ['analysis_windows.csv','window_id','Unique derived analysis-window identifier.'],
    ['analysis_windows.csv','analysis_label','Step analysis label or role.'],
    ['analysis_windows.csv','start_event_id','Event that opened the window.'],
    ['analysis_windows.csv','end_event_id','Event that closed the window. Empty means missing end event.'],
    ['analysis_windows.csv','expected_duration_ms','Configured duration when available.'],
    ['analysis_windows.csv','duration_ms','Actual elapsed duration including recorded pauses.'],
    ['analysis_windows.csv','pause_count','Number of pause events inside the window.'],
    ['analysis_windows.csv','validity_status','valid, attention, or invalid.'],
    ['analysis_windows.csv','invalid_reason','Reason for invalid or attention status.'],
    ['analysis_windows.csv','overlapping_markers','Manual markers or marker intervals overlapping the window, separated by |.'],
    ['responses.csv','response_id','Response row identifier.'],
    ['responses.csv','questionnaire_id','Questionnaire identifier.'],
    ['responses.csv','question_id','Question identifier or Response-node variable; can also be used in flow condition rules.'],
    ['responses.csv','question_type','Question type such as likert, single_choice, short_text, or response_choice.'],
    ['responses.csv','value','Raw answer value; multiple choices use | separator. Missed required response windows export an empty value.'],
    ['responses.csv','option_label','Displayed option label for Response nodes when available.'],
    ['responses.csv','response_key','Keyboard key used for a Response node when configured.'],
    ['responses.csv','reaction_time_ms','Milliseconds from Response-node display to the selected answer. Empty for ordinary questionnaire rows.'],
    ['responses.csv','submitted_epoch_ms','Submission time in Unix epoch milliseconds.'],
    ['stimulus_manifest.csv','stimulus_id','Stimulus identifier from library or step resource.'],
    ['stimulus_manifest.csv','source_mode','url, youtube, upload, or library.'],
    ['stimulus_manifest.csv','asset_id','Browser-local upload asset ID.'],
    ['stimulus_manifest.csv','checksum','SHA-256 checksum for locally uploaded media when available.'],
    ['stimulus_manifest.csv','metadata_json','Stimulus metadata and step playback options.'],
  ];
  return {
    'README.txt': readme,
    'export_manifest.json': JSON.stringify(exportManifest, null, 2),
    'session.json':JSON.stringify(cleanSession, null, 2), 'protocol.json':JSON.stringify(protocol, null, 2),
    'integrity_report.json':JSON.stringify(report, null, 2),
    'events.csv':csv(eventHeaders, events.map(event => eventHeaders.map(header => header === 'metadata_json' ? JSON.stringify(event.metadata) : event[header]))),
    'analysis_windows.csv':csv(windowHeaders, analysisWindows.map(window => windowHeaders.map(header => window[header]))),
    'responses.csv':csv(responseHeaders, responses.map(response => responseHeaders.map(header => response[header]))),
    'stimulus_manifest.csv':csv(manifestHeaders, manifest.map(item => manifestHeaders.map(header => header === 'metadata_json' ? JSON.stringify(item.metadata) : item[header]))),
    'data_dictionary.csv':csv(['file','field','description'], dataDictionary),
  };
}

const crcTable=Array.from({length:256},(_,number)=>{let value=number;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0});
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0};
const zipHeader=(size,writer)=>{const bytes=new Uint8Array(size),view=new DataView(bytes.buffer);writer(view);return bytes};

export function zipBundle(files) {
  const encoder=new TextEncoder(),localParts=[],centralParts=[];let offset=0;
  Object.entries(files).forEach(([name,content])=>{
    const safePath=name.split(/[\\/]/).filter(part=>part&&part!=='.'&&part!=='..').map(part=>part.replace(/[<>:"|?*\p{Cc}]/gu,'_')).join('/')||'file',nameBytes=encoder.encode(safePath),data=encoder.encode(content),checksum=crc32(data);
    const local=zipHeader(30,(view)=>{view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x0800,true);view.setUint16(8,0,true);view.setUint32(14,checksum,true);view.setUint32(18,data.length,true);view.setUint32(22,data.length,true);view.setUint16(26,nameBytes.length,true)});
    localParts.push(local,nameBytes,data);
    const central=zipHeader(46,(view)=>{view.setUint32(0,0x02014b50,true);view.setUint16(4,20,true);view.setUint16(6,20,true);view.setUint16(8,0x0800,true);view.setUint16(10,0,true);view.setUint32(16,checksum,true);view.setUint32(20,data.length,true);view.setUint32(24,data.length,true);view.setUint16(28,nameBytes.length,true);view.setUint32(42,offset,true)});
    centralParts.push(central,nameBytes);offset+=local.length+nameBytes.length+data.length;
  });
  const centralSize=centralParts.reduce((total,part)=>total+part.length,0),count=Object.keys(files).length;
  const end=zipHeader(22,(view)=>{view.setUint32(0,0x06054b50,true);view.setUint16(8,count,true);view.setUint16(10,count,true);view.setUint32(12,centralSize,true);view.setUint32(16,offset,true)});
  return new Blob([...localParts,...centralParts,end],{type:'application/zip'});
}

export function downloadBundle(files, prefix) {
  const anchor=document.createElement('a');
  const safePrefix=String(prefix||'physioflow').replace(/[<>:"/\\|?*\p{Cc}]/gu,'_');
  anchor.href=URL.createObjectURL(zipBundle(files));anchor.download=`${safePrefix}_session_bundle.zip`;anchor.click();
  setTimeout(()=>{try{URL.revokeObjectURL(anchor.href)}catch{/* ignore */}},30000);
}

// ── Simplified export (5 files, clean columns) ──

/** Build a human-readable step path like "Block 1 / Trial 2 / Fixation" */
function stepPath(protocol, event) {
  const block = protocol.blocks?.find(b => b.block_id === event.block_id);
  const trial = block?.trials?.find(t => t.trial_id === event.trial_id);
  const step = trial?.steps?.find(s => s.step_id === event.step_id);
  const bi = block ? protocol.blocks.indexOf(block) + 1 : '?';
  const ti = trial && block ? block.trials.indexOf(trial) + 1 : '?';
  return `${block?.name || 'Block ' + bi} / ${trial?.name || 'Trial ' + ti} / ${step?.name || step?.type || '?'}`;
}

export function bundleSimple(session, protocol, events, responses = []) {
  const report = assessSession({ session, protocol, events, responses, runtime: session.runtime_snapshot });

  // ── events.csv (10 columns) ──
  const eventHeaders = ['time_sec', 'event', 'step_path', 'condition', 'duration_ms', 'rt_ms', 'note', 'status'];
  const eventRows = events.map(e => {
    const path = stepPath(protocol, e);
    const duration = e.metadata?.duration_ms ?? (e.event_type === 'step_entered' ? '' : '');
    const rt = e.metadata?.reaction_time_ms ?? '';
    let note = '';
    if (e.metadata?.marker_type) note = `marker:${e.metadata.marker_type}` + (e.metadata.note ? ` "${e.metadata.note}"` : '');
    else if (e.metadata?.confirmation_label) note = e.metadata.confirmation_label;
    else if (e.metadata?.response_variable) note = `${e.metadata.response_variable}=${e.metadata.response_value || ''}`;
    return [
      (e.elapsed_monotonic_ms / 1000).toFixed(3),
      e.event_type,
      path,
      e.condition || '',
      duration,
      rt,
      note,
      e.event_status || 'ok',
    ];
  });

  // ── responses.csv (7 columns) ──
  const respHeaders = ['time_sec', 'step_path', 'question', 'answer', 'rt_ms', 'question_type', 'response_key'];
  const respRows = responses.map(r => ({
    ...r,
    _path: (() => {
      const block = protocol.blocks?.find(b => b.block_id === r.block_id);
      const trial = block?.trials?.find(t => t.trial_id === r.trial_id);
      const step = trial?.steps?.find(s => s.step_id === r.step_id);
      return `${block?.name || ''} / ${trial?.name || ''} / ${step?.name || ''}`;
    })(),
  })).map(r => [
    (r.submitted_epoch_ms ? (r.submitted_epoch_ms - (session.started_at ? new Date(session.started_at).getTime() : 0)) / 1000 : ''),
    r._path,
    r.question_id || '',
    String(r.value ?? ''),
    r.reaction_time_ms || '',
    r.question_type || '',
    r.response_key || '',
  ]);

  // ── analysis_windows.csv (9 columns) ──
  const aws = windows(events, protocol);
  const awHeaders = ['time_sec', 'step_path', 'condition', 'label', 'duration_ms', 'pauses', 'validity', 'issue', 'markers'];
  const awRows = aws.map(w => ({
    ...w,
    _path: stepPath(protocol, { block_id: w.block_id, trial_id: w.trial_id, step_id: w.step_id }),
  })).map(w => [
    w.start_epoch_ms ? ((w.start_epoch_ms - (session.started_at ? new Date(session.started_at).getTime() : 0)) / 1000).toFixed(3) : '',
    w._path,
    w.condition || '',
    w.analysis_label || '',
    w.duration_ms || '',
    w.pause_count || 0,
    w.validity_status || '',
    w.invalid_reason || '',
    w.overlapping_markers || '',
  ]);

  // ── Session summary ──
  const summary = {
    participant_id: session.participant_id,
    protocol_name: protocol.name,
    protocol_version: protocol.version,
    status: session.status,
    started_at: session.started_at,
    ended_at: session.ended_at,
    run_mode: session.run_mode,
    total_events: events.length,
    total_responses: responses.length,
    total_analysis_windows: aws.length,
    integrity: { validity: report.validity_status, issues: report.issues?.length || 0, warnings: report.warnings?.length || 0 },
    export_generated_at: new Date().toISOString(),
  };

  const readme = [
    `PhysioFlow Session — ${session.participant_id}`,
    '',
    `Protocol: ${protocol.name} (v${protocol.version})`,
    `Status: ${session.status}  |  Mode: ${session.run_mode || 'formal'}`,
    `Events: ${events.length}  |  Responses: ${responses.length}  |  Analysis windows: ${aws.length}`,
    '',
    'Files:',
    '  events.csv          — Timeline of every step, marker, and media event',
    '  responses.csv       — Questionnaire answers and Response-node choices',
    '  analysis_windows.csv — Derived intervals for physiology analysis',
    '  session.json        — Session metadata and integrity summary',
    '  protocol.json       — The protocol configuration used',
    '',
    'Column reference (events.csv):',
    '  time_sec     Seconds from session start',
    '  event        Event type (step_entered, step_completed, manual_marker, etc.)',
    '  step_path    Human-readable path through Block / Trial / Step',
    '  condition    Trial condition label',
    '  duration_ms  Event duration when available',
    '  rt_ms        Reaction time for responses',
    '  note         Marker text, confirmation label, or response value',
    '  status       ok | warning | error',
    '',
    'Column reference (responses.csv):',
    '  time_sec, step_path, question, answer, rt_ms, question_type, response_key',
    '',
    'Column reference (analysis_windows.csv):',
    '  time_sec, step_path, condition, label, duration_ms, pauses, validity, issue, markers',
    '',
  ].join('\n');

  return {
    'README.txt': readme,
    'session.json': JSON.stringify(summary, null, 2),
    'protocol.json': JSON.stringify(protocol, null, 2),
    'events.csv': csv(eventHeaders, eventRows),
    'responses.csv': csv(respHeaders, respRows),
    'analysis_windows.csv': csv(awHeaders, awRows),
  };
}

export function downloadSimpleBundle(session, protocol, events, responses = []) {
  const files = bundleSimple(session, protocol, events, responses);
  downloadBundle(files, session.participant_id || 'session');
}

// ── BIDS-compatible export ──
// BIDS v1.8.0 behavioral events format
// See: https://bids-specification.readthedocs.io/en/stable/modality-specific-files/behavioral-experiments.html

const tsvesc = value => {
  if (value == null || value === '') return 'n/a';
  const s = String(value);
  // In TSV, tabs and newlines must be escaped
  return s.includes('\t') || s.includes('\n') ? `"${s.replace(/"/g, '""').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"` : s;
};

function bidsEventTsv(events) {
  const rows = events.map(e => [
    (e.elapsed_monotonic_ms / 1000).toFixed(3),                    // onset in seconds
    (e.metadata?.duration_ms ? (e.metadata.duration_ms / 1000).toFixed(3) : 'n/a'), // duration
    e.condition || e.event_type || 'n/a',                           // trial_type
    e.metadata?.reaction_time_ms != null ? (e.metadata.reaction_time_ms / 1000).toFixed(3) : 'n/a',
    e.block_id || 'n/a',
    e.trial_id || 'n/a',
    e.step_id || 'n/a',
    e.condition || 'n/a',
    e.event_type || 'n/a',
  ].map(tsvesc).join('\t'));
  return 'onset\tduration\ttrial_type\tresponse_time\tblock_id\ttrial_id\tstep_id\tcondition\tevent_type\n' + rows.join('\n') + '\n';
}

function bidsEventsSidecar(session, protocol) {
  const sidecar = {
    TaskName: protocol.name || 'experiment',
    TaskDescription: 'PhysioFlow experiment session',
    Instructions: 'See protocol.json for full trial structure',
    CogAtlasID: '',
    CogPOID: '',
    InstitutionName: '',
    InstitutionAddress: '',
    DeviceSerialNumber: '',
    SampledChannels: 'See data_dictionary.csv',
    SampleRate: 'See data_dictionary.csv',
    Manufacturer: 'PhysioFlow',
    ManufacturersModelName: `PhysioFlow v${protocol.app_version || '0.2.0'}`,
    SoftwareVersions: `PhysioFlow v${protocol.app_version || '0.2.0'}`,
    TaskDescription_i18n: {
      participant_id: session.participant_id || '',
      protocol_hash: session.protocol_hash || '',
      run_mode: session.run_mode || '',
    },
    columns: {
      onset: { Description: 'Event onset in seconds from session start (monotonic clock).', Units: 'seconds' },
      duration: { Description: 'Event duration in seconds.', Units: 'seconds' },
      trial_type: { Description: 'Trial condition label or event type.' },
      response_time: { Description: 'Participant response time in seconds. n/a when not applicable.', Units: 'seconds' },
      block_id: { Description: 'Block identifier from protocol hierarchy.' },
      trial_id: { Description: 'Trial identifier from protocol hierarchy.' },
      step_id: { Description: 'Step identifier from protocol hierarchy.' },
      condition: { Description: 'Trial condition label.' },
      event_type: { Description: 'Event type: step_entered, step_completed, media_play_started, manual_marker, etc.' },
    },
  };
  return JSON.stringify(sidecar, null, 2);
}

function bidsParticipantsTsv(session) {
  const row = [
    `sub-${String(session.participant_id || '').replace(/[^a-zA-Z0-9]/g, '')}`,
    session.session_id || '',
    session.protocol_name || '',
    session.run_mode || 'formal',
    session.started_at || 'n/a',
    session.ended_at || 'n/a',
    session.participant_language || 'n/a',
    session.sync_method || 'same_computer_clock',
    session.timezone || 'Asia/Tokyo',
    session.sampling_rate || 'n/a',
  ].map(tsvesc).join('\t');
  return 'participant_id\tsession_id\tprotocol_name\trun_mode\tstarted_at\tended_at\tparticipant_language\tsync_method\ttimezone\tsampling_rate\n' + row + '\n';
}

export function bidsBundle(session, protocol, events, responses = []) {
  const subId = `sub-${String(session.participant_id || 'unknown').replace(/[^a-zA-Z0-9]/g, '')}`;
  const sesId = `ses-${(session.started_at || '').replace(/[^0-9]/g, '').slice(0, 8) || '01'}`;
  const taskName = (protocol.name || 'task').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'experiment';
  const prefix = `${subId}/${sesId}/beh/${subId}_${sesId}_task-${taskName}`;

  const files = {};
  files[`${prefix}_events.tsv`] = bidsEventTsv(events);
  files[`${prefix}_events.json`] = bidsEventsSidecar(session, protocol);
  files[`${prefix}_beh.json`] = JSON.stringify({
    TaskName: protocol.name,
    ParticipantId: session.participant_id,
    SessionId: session.session_id,
    ProtocolVersion: protocol.version,
    ProtocolHash: session.protocol_hash || '',
    RunMode: session.run_mode,
    EventCount: events.length,
    ResponseCount: responses.length,
  }, null, 2);
  files[`participants.tsv`] = bidsParticipantsTsv(session);
  files[`dataset_description.json`] = JSON.stringify({
    Name: protocol.name || 'PhysioFlow experiment',
    BIDSVersion: '1.8.0',
    DatasetType: 'raw',
    License: 'CC0',
    Authors: [''],
    HowToAcknowledge: '',
    Funding: [''],
    EthicsApprovals: [''],
    ReferencesAndLinks: [''],
    DatasetDOI: '',
    GeneratedBy: [{ Name: 'PhysioFlow', Version: protocol.app_version || '0.2.0' }],
  }, null, 2);
  files['README'] = [
    'BIDS-compatible PhysioFlow session export',
    '',
    `Participant: ${session.participant_id}`,
    `Session: ${session.session_id}`,
    `Protocol: ${protocol.name}`,
    '',
    'Directory structure:',
    `  ${subId}/`,
    `    ${sesId}/`,
    `      beh/`,
    `        *_events.tsv   — Event timing in BIDS format`,
    `        *_events.json  — Column descriptions (sidecar)`,
    `        *_beh.json     — Session-level behavioral metadata`,
    '  participants.tsv  — Participant metadata',
    '  dataset_description.json',
    '',
    'For full data, also export the standard PhysioFlow session ZIP.',
  ].join('\n');

  return files;
}

export function downloadBidsBundle(session, protocol, events, responses = []) {
  const files = bidsBundle(session, protocol, events, responses);
  const subId = `sub-${String(session.participant_id || 'unknown').replace(/[^a-zA-Z0-9]/g, '')}`;
  const anchor = document.createElement('a');
  const safePrefix = `${subId}_bids_export`;
  const zip = zipBundle(files);
  anchor.href = URL.createObjectURL(zip);
  anchor.download = `${safePrefix}.zip`;
  anchor.click();
  setTimeout(() => { try { URL.revokeObjectURL(anchor.href); } catch { /* ignore */ } }, 30000);
}
