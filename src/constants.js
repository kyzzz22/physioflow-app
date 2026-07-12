// constants.js — Shared constants, palette, and type metadata

export const STEP_TYPES = ['instruction','fixation','timer','video','audio','image','questionnaire','response','manual_event','rest','device_check','attention_check','screen_calibration'];

export const ROLES = ['baseline','stimulus','recovery','task','exclude','custom'];

export const PALETTE = [
  { title: 'Presentation', items: [['instruction', 'Aa', 'Instruction'], ['fixation', '＋', 'Fixation'], ['timer', '◷', 'Timer'], ['rest', '☕', 'Rest']] },
  { title: 'Media', items: [['video', '▶', 'Video'], ['audio', '♫', 'Audio'], ['image', '▧', 'Image']] },
  { title: 'Interaction', items: [['questionnaire', '☷', 'Questionnaire'], ['response', '↵', 'Response'], ['attention_check', '⚠', 'Attention check'], ['manual_event', '◆', 'Manual event'], ['device_check', '✓', 'Device check']] },
  { title: 'Setup', items: [['screen_calibration', '⊞', 'Screen calibration']] },
];

export const PALETTE_ICONS = Object.fromEntries(PALETTE.flatMap(g => g.items).map(([type, icon]) => [type, icon]));

export const STEP_DEFAULTS = {
  instruction: { name: 'Instruction', duration_mode: 'fixed', planned_duration_ms: 5000, icon: 'Aa', show_countdown_ring: false },
  fixation:    { name: 'Fixation',    duration_mode: 'fixed', planned_duration_ms: 5000, icon: '＋', show_countdown_ring: true },
  timer:       { name: 'Timer',       duration_mode: 'fixed', planned_duration_ms: 5000, icon: '◷', show_countdown_ring: true },
  rest:        { name: 'Rest',        duration_mode: 'fixed', planned_duration_ms: 5000, icon: '☕', show_countdown_ring: true },
  video:       { name: 'Video',       duration_mode: 'media', planned_duration_ms: 5000, icon: '▶', recovery_behavior: 'restart' },
  audio:       { name: 'Audio',       duration_mode: 'media', planned_duration_ms: 5000, icon: '♫', recovery_behavior: 'restart' },
  image:       { name: 'Image',       duration_mode: 'fixed', planned_duration_ms: 3000, icon: '▧' },
  questionnaire: { name: 'Questionnaire', duration_mode: 'manual', planned_duration_ms: 0, icon: '☷', questionnaire_mode: 'internal', external_form_url: '', external_open_label: 'Open external form', external_completion_label: 'I completed the external form', external_embed: false, external_append_context: true, external_participant_param: 'participant_id', external_session_param: 'session_id' },
  response:    { name: 'Response',    duration_mode: 'manual', planned_duration_ms: 0, icon: '↵', response_variable: 'response', response_required: true, response_auto_advance: true, response_options: [
    { value: 'yes', key: '1', label_i18n: { zh: '是', ja: 'はい', en: 'Yes' } },
    { value: 'no', key: '2', label_i18n: { zh: '否', ja: 'いいえ', en: 'No' } },
  ] },
  manual_event:{ name: 'Manual event',duration_mode: 'manual', planned_duration_ms: 0, icon: '◆', operator_confirm_label: 'Confirm event', operator_note_required: false },
  device_check:{ name: 'Device check',duration_mode: 'manual', planned_duration_ms: 0, icon: '✓', device_checks: ['Sensor connected', 'Recording software ready', 'Sync reference prepared'], require_all_device_checks: true },
  attention_check:{ name: 'Attention check', duration_mode: 'fixed', planned_duration_ms: 3000, icon: '⚠', attention_prompt_i18n: { zh: '请按空格键', ja: 'スペースキーを押してください', en: 'Press the spacebar now' }, attention_expected_key: ' ', attention_timeout_ms: 2000, attention_feedback_duration_ms: 800, attention_pass_feedback_i18n: { zh: '✓ 已检测到响应', ja: '✓ 反応を検出しました', en: '✓ Response detected' }, attention_fail_feedback_i18n: { zh: '✗ 未检测到响应', ja: '✗ 応答が検出されませんでした', en: '✗ No response detected' } },
  screen_calibration:{ name: 'Screen calibration', duration_mode: 'manual', planned_duration_ms: 0, icon: '⊞', calibration_viewing_distance_cm: 60, calibration_display_width_cm: null, calibration_display_height_cm: null, calibration_check_items: ['Display at native resolution', 'Scaling at 100% in OS settings', 'Brightness at comfortable level', 'Measure viewing distance'], require_all_calibration_checks: true },
};

export const STEP_GUIDE = {
  instruction: {
    summary: 'Shows participant-facing text before or between tasks.',
    setup: 'Fill participant content in at least one language, then choose fixed time or manual continue.',
    output: 'Exports step_entered and step_completed events; no response row is created.',
  },
  fixation: {
    summary: 'Displays a centered cross for baseline or gaze reset periods.',
    setup: 'Use fixed duration and mark as an analysis window when it is a baseline interval.',
    output: 'Creates an analysis_windows.csv row when analysis window is enabled.',
  },
  timer: {
    summary: 'Shows a countdown without media or questionnaire content.',
    setup: 'Use fixed duration for timed tasks, waiting screens, or short breaks.',
    output: 'Exports timing events and optional analysis windows.',
  },
  rest: {
    summary: 'Recovery period between trials or stimuli.',
    setup: 'Use fixed duration and role recovery when the interval should be analyzed.',
    output: 'Useful for recovery windows in analysis_windows.csv.',
  },
  video: {
    summary: 'Plays local, uploaded, URL, or YouTube video stimuli.',
    setup: 'Assign a source. Local files give the most reliable play/end events; YouTube timing is flagged for attention.',
    output: 'Exports media events, stimulus manifest rows, and optional stimulus analysis windows.',
  },
  audio: {
    summary: 'Plays sound stimuli while logging media lifecycle events.',
    setup: 'Assign a source and set volume, loop, controls, and duration behavior.',
    output: 'Exports media events and stimulus_manifest.csv metadata.',
  },
  image: {
    summary: 'Presents a still image stimulus.',
    setup: 'Assign a source and keep fixed duration unless the operator should advance manually.',
    output: 'Exports step events and stimulus manifest metadata.',
  },
  questionnaire: {
    summary: 'Collects participant responses with required/optional questions.',
    setup: 'Use the built-in designer for row-level responses, or switch to external form mode for Google Forms / Qualtrics links. External links can append participant/session parameters for later joins.',
    output: 'Built-in answers appear in responses.csv. External forms export open/confirmed timing events and the resolved form URL in events.csv.',
  },
  response: {
    summary: 'Captures a single quick participant response with button or keyboard input.',
    setup: 'Set the prompt, response variable, option values, labels, and optional keys. Use it for stimulus ratings, forced-choice tasks, and reaction-time responses.',
    output: 'Exports one responses.csv row with value, option label, response key, and reaction_time_ms. The response variable can drive Condition nodes.',
  },
  manual_event: {
    summary: 'Pauses the run until the operator confirms an external event.',
    setup: 'Set the confirmation label and decide whether the operator must enter a note before continuing.',
    output: 'Exports manual_event_confirmed plus step timing, operator note, and confirmation label.',
  },
  device_check: {
    summary: 'Operator checkpoint for sensors, acquisition software, or room setup.',
    setup: 'Configure the checklist items that must be ticked before the run can continue.',
    output: 'Exports device_check_completed with item-level pass state, note, and setup timing.',
  },
  attention_check: {
    summary: 'Catch trial to verify participant attention. Shows a prompt and expects a specific keypress within a time window.',
    setup: 'Configure the prompt, expected key, timeout duration, and pass/fail feedback text. Use in condition nodes with last_attention_passed to branch.',
    output: 'Exports attention_check_passed / attention_check_failed with reaction time, expected key, and actual key.',
  },
  screen_calibration: {
    summary: 'Pre-experiment display calibration to measure screen dimensions and viewing distance for visual angle calculations.',
    setup: 'Enter viewing distance and screen dimensions. The operator confirms display settings before the session proceeds.',
    output: 'Exports calibration measurements and calculated pixels-per-degree value for visual angle reference.',
  },
};

export const CONTROL_NODE_GUIDE = {
  start: {
    summary: 'Entry point for the selected trial flow.',
    setup: 'Connect Start to the first event or control node.',
  },
  condition: {
    summary: 'Chooses true or false path from participant fields, trial condition, or questionnaire answers.',
    setup: 'Set a variable, comparison, and value; connect both true and false ports.',
  },
  loop: {
    summary: 'Repeats a body path until a rule fails or the maximum iteration count is reached.',
    setup: 'Connect body and exit ports; keep the maximum finite to protect runs.',
  },
  end: {
    summary: 'Stops the current trial unit and advances to the next repeat, trial, or block.',
    setup: 'At least one End node must be reachable from Start.',
  },
};

export const QUICK_START_STEPS = [
  ['1', 'Create or import', 'Start from a blank protocol, the emotion template, or a validated protocol JSON file.'],
  ['2', 'Arrange hierarchy', 'Use Blocks & Trials for repeat order, latin-square/randomization, and trial conditions.'],
  ['3', 'Build the flow', 'Add event nodes, connect ports, and use Condition/Loop nodes for branches and repeats.'],
  ['4', 'Fill content', 'Attach media, write instructions, configure questionnaires, and mark analysis windows.'],
  ['5', 'Validate and freeze', 'Run the protocol check, select a local data folder, then freeze and start a formal session.'],
  ['6', 'Export data', 'Download the session ZIP and use the included data dictionary for downstream analysis.'],
];

export const OUTPUT_FILES = [
  ['README.txt', 'Human-readable guide for the session export package.'],
  ['export_manifest.json', 'Machine-readable package manifest, protocol/session IDs, generation time, and record counts.'],
  ['session.json', 'Session metadata, participant ID, sync settings, run status, and integrity summary.'],
  ['protocol.json', 'Frozen or draft protocol snapshot used for this session.'],
  ['events.csv', 'Append-only event log for blocks, trials, graph nodes, steps, media, pauses, retries, skips, and markers.'],
  ['responses.csv', 'Questionnaire answers: one row per submitted question answer.'],
  ['analysis_windows.csv', 'Derived analysis intervals for steps with Generate analysis window enabled.'],
  ['stimulus_manifest.csv', 'Stimulus sources, upload IDs, filenames, checksums, and metadata.'],
  ['integrity_report.json', 'Automated checks for event continuity, missing ends, invalid windows, and timing attention flags.'],
  ['data_dictionary.csv', 'Machine-readable field descriptions for the exported CSV files.'],
];

export const SYSTEM_GUIDE_SECTIONS = [
  ['Build', 'Create or import a protocol, then organize Blocks and Trials before editing the visual flow.'],
  ['Readiness', 'Use the dashboard checklist to confirm structure, content, media, analysis windows, frozen version, pilot run, and local storage.'],
  ['Validate', 'Run the checklist, fix blocking errors, and freeze the version that will be used for formal data collection.'],
  ['Run', 'Enter participant and device sync metadata, preview the actual trial order, then start the session.'],
  ['Review', 'Use Sessions and Analytics to inspect integrity, responses, analysis windows, markers, and timing.'],
  ['Export', 'Export the complete session ZIP. Keep the ZIP with the frozen protocol and external device files.'],
];

export const STORAGE_GUIDE = [
  ['Desktop app', 'The click-to-use Tauri build stores protocols, sessions, recovery snapshots, and uploaded assets in ~/Documents/PhysioFlow Data. Use Open folder on the dashboard to reveal it.'],
  ['Data folders', 'The folder contains projects/, sessions/, assets/, and current_run.json. Frozen formal sessions cannot start until this folder is selected. Back it up or copy it when moving work to another machine.'],
  ['Web package', 'The Web ZIP is lightweight, but index.html must be served by the included start script because modern browsers block ES modules from file:// pages.'],
  ['Browser fallback', 'If the web build cannot access a local folder, drafts and preview runs may fall back to browser storage. Formal collection is blocked until a local folder is selected.'],
  ['Distribution', 'On macOS share the .dmg or .app from release-desktop. Build Windows and Linux installers on those systems for native one-click packages.'],
];

export const DATA_FORMAT_GUIDE = [
  ['events.csv', 'Primary timeline table. Use session_id, event_type, block_id, trial_id, node_id, step_id, elapsed_ms, and timestamp_iso to align behavior with physiological recordings.'],
  ['responses.csv', 'Built-in questionnaire and Response-node table. Each row is one answer with question_id, prompt/variable, value, option label, response key, reaction time when available, trial context, and elapsed time. External forms keep answers in the external service and record completion timing/resolved URL in events.csv.'],
  ['analysis_windows.csv', 'Derived intervals for baseline, stimulus, task, recovery, and custom windows. Join by session_id and trial/step identifiers.'],
  ['stimulus_manifest.csv', 'Stimulus provenance table. It records local asset IDs, filenames, MIME type, source URLs, checksums, and attention flags.'],
  ['integrity_report.json', 'Automated quality report for missing terminal events, invalid windows, unclosed markers, and timing caveats.'],
  ['data_dictionary.csv', 'Column-level reference for the CSV files. Use this first when building analysis scripts.'],
];

export const MEDIA_TYPES = ['video', 'audio', 'image'];

export const MARKER_TYPES = ['cough', 'speech', 'movement', 'device_adjustment', 'device_disconnected', 'distraction', 'sync_marker', 'operator_note', 'custom'];

export const COMPARISON_OPS = ['equals', 'not_equals', 'contains', 'greater_than', 'less_than'];

export const SYNC_METHODS = ['same_computer_clock', 'manual_offset', 'manual_marker'];

export const SYNC_TIME_FORMATS = ['epoch_ms', 'epoch_s', 'iso8601', 'relative_ms'];

export const FONT_SIZES = [
  ['', 'Trial default'],
  ['0.7rem', 'Small (0.7rem)'],
  ['1rem', 'Medium (1rem)'],
  ['1.5rem', 'Large (1.5rem)'],
  ['2rem', 'Extra large (2rem)'],
];

export const MAX_UNDO = 60;
export const MAX_CONTROL_TRANSITIONS = 10000;
export const MAX_FLOW_TRANSITIONS = 5000;

export const APP_VERSION = '0.3.0';
