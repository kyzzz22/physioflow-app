# Changelog

All notable changes to PhysioFlow are documented in this file.

## [0.3.0] — 2026-07-12

### Added

#### Experiment design
- **ITI jittering**: Trials support `iti_jitter_ms` and `iti_jitter_distribution` (fixed, uniform, normal, exponential). Jitter is applied between trial repetitions at runtime.
- **Randomization constraints**: Blocks support `max_consecutive_same` (limit consecutive trials with identical condition) and `no_immediate_repeat` (prevent back-to-back same-condition trials). Active only when `order_rule` is `random`.
- **Practice blocks**: Blocks have an `is_practice` flag. Practice trials are excluded from analysis windows and carry the flag through session exports.
- **Attention check step**: New `attention_check` step type for catch trials. Configurable prompt (i18n), expected key, timeout, and pass/fail feedback. Variable `last_attention_passed` available in Condition nodes.
- **Screen calibration step**: New `screen_calibration` step type with operator checklist for display resolution, scaling, brightness, and viewing distance.

#### Templates
- **Stroop task template**: 16-trial color-word Stroop (4 colors × 4 words) with congruent/incongruent conditions, practice block, constrained randomization, and jittered ITI.
- **Go/No-Go task template**: 40-trial inhibition task (70% Go / 30% No-Go) with practice block and jittered ITI.

#### Runtime & branching
- **Performance tracking**: Runtime variables `last_accuracy`, `last_rt_ms`, `cumulative_accuracy`, `last_attention_passed`, `attention_fail_count`, `attention_total_count` are computed automatically and can drive Condition node branching for adaptive experiments.
- **Attention result recording**: `recordAttentionResult(runtime, passed, rtMs)` function for explicit attention check state updates.

#### Export
- **BIDS v1.8.0 export**: `bidsBundle()` generates BIDS-compliant behavioral directory structure with `*_events.tsv`, `*_events.json` (sidecar), `*_beh.json`, `participants.tsv`, and `dataset_description.json`. `downloadBidsBundle()` provides one-click download.

#### Developer utilities
- **Visual angle calculator** (`src/visualAngle.js`): Functions for `pixelsPerDegree`, `cmToVisualAngle`, `visualAngleToCm`, `pixelsToVisualAngle`, `visualAngleToPixels`, `calibrationReport`, `estimateScreenSize`, and `getViewportDimensions`.

#### UX
- **Flow snapshot history**: Save, restore, rename, and delete named flow states (nodes + edges + steps) per trial. Stored in localStorage (last 20 per trial).
- **Operator quick notes**: Textarea in the runtime markers sidebar for one-click timestamped operator notes.
- **ITI jitter & constraint UI controls**: Visible in Block and Trial headers when applicable.
- **Practice block toggle**: Checkbox in Block header.
- **Template buttons**: Stroop and Go/No-Go templates available from the Dashboard.

### Changed
- `resolveTrials()` now accepts a `constraints` parameter for max-consecutive and no-repeat rules.
- `expandUnits()` passes block constraints and includes ITI jitter / practice flags on each runtime unit.
- `completeRuntimeStep()` tracks accuracy and reaction time when answers include `expected_value` or `reaction_time_ms`.
- `createRuntime()` initializes performance tracking variables.
- Flow validation's `knownVariables` set includes all new performance variables.

---

## [0.2.0] — 2026-07-03

### Added
- Initial public release.
- Visual flow editor with drag-and-drop nodes (event, condition, loop, start, end, note, junction).
- Block → Trial → Step hierarchy with repeat counts and order rules (fixed, random, latin_square, manual).
- 11 step types: instruction, fixation, timer, video, audio, image, questionnaire, response, manual_event, rest, device_check.
- Multi-language participant content (zh, ja, en).
- Media support: URL, YouTube embed, and local file upload for video/audio/image.
- Built-in questionnaire designer and external form support (Google Forms, Qualtrics).
- Protocol validation, freezing, versioning, diff, and hash verification.
- Session runner with recovery snapshots, pause/resume, skip/retry, and manual markers.
- ZIP export with events.csv, responses.csv, analysis_windows.csv, stimulus_manifest.csv, integrity_report.json, and data_dictionary.csv.
- Analytics dashboard: cross-session comparison, timeline view, response charts, and analysis window cards.
- Lab readiness checklist per project and workspace-level summary.
- Local-first data storage: File System Access API (web) and `~/Documents/PhysioFlow Data` (Tauri desktop).
- Dark mode / light mode with system preference detection.
- Undo/redo with 60-step history.
- In-app guide panel with workflow, node types, data format, and storage documentation.
- Emotion experiment template (five-condition with SAM questionnaire).
- Tauri desktop app build target.
