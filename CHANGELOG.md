# Changelog

All notable changes to PhysioFlow are documented in this file.

## [0.4.0] — 2026-07-13

### Added

#### Questionnaire overhaul
- **Drag-and-drop reordering**: Questions can be reordered via drag handle.
- **Conditional logic**: `show_if` field for skip/display logic (equals, not_equals, contains, greater_than, less_than).
- **11 question presets**: SAM valence/arousal, Likert 5/7, NPS, VAS slider, single/multiple choice, short/long text, number — one-click insert.
- **Auto-scoring**: `correct_answer` field with submit-time score calculation and export.
- **VAS slider type**: Visual analog scale (range slider 0-100) with min/max labels.
- **Random question order**: Questionnaire-level `shuffle_questions` + per-question option shuffle.
- **Progress bar**: Green progress indicator with answered/total count.
- **Batch CSV import**: Paste CSV (`type,en,options,min,max,answer`) to create multiple questions.

#### Full-screen node preview with inline editing
- **✎ Edit button**: Toggle between preview and edit mode. Edit name, content (zh/ja/en), response options, questionnaire, media source, duration, start mode, and analysis window flag — all in-place.
- **Preview accuracy**: Matches actual runtime rendering exactly (trial layout colors, padding, content width, eyebrow, step name heading).

#### Flow editor improvements
- **Undo/Redo**: Ctrl+Z / Ctrl+Shift+Z for node operations (drag, delete, connect, property changes). 40-step history.
- **Code splitting**: Analytics lazy-loaded (28KB separate chunk). Main bundle 552KB.
- **Canvas toolbar**: Fixed 34px single-row bar. Collapsible left palette and right inspector.
- **Flow snapshots**: Save/restore/rename/delete named flow states per trial.

#### Template configuration
- **Stroop task**: Configurable trial count, ITI jitter, practice block toggle.
- **Go/No-Go task**: Configurable trial count, go ratio (50-90%), ITI jitter, practice block toggle.

#### Simplified export
- **`bundleSimple()`**: 5 files (down from 10) with human-readable columns. `time_sec`, `step_path`, 8-column events.
- **BIDS v1.8.0 export**: `bidsBundle()` for neuroimaging pipelines.

#### Improved i18n coverage
- **300+ translation entries** for zh (中文) and ja (日本語) across all UI surfaces.

### Changed

#### UI/UX redesign
- **Flow editor nodes**: Compact 178px cards with left color accent, inline rule display, pill-shaped output ports, hover elevation.
- **Runtime participant interface**: Redesigned operator bar (48px), thinner fixation cross, smaller timer ring, larger response buttons, card-based questionnaire fieldsets, glass-morphism pause overlay.
- **Markers sidebar**: Collapsible, floating toggle button always visible.
- **Canvas bar**: Single-row fixed height, no wrapping.

#### CSS architecture
- Node/canvas-bar CSS consolidated into single source of truth. Removed 200+ lines of duplicates.
- Dark mode: Toast notifications, questionnaire form, audio player, scale inputs, choice lists all fixed.

### Fixed
- Node connection drag bug (React closure stale state + coordinate system mismatch).
- Canvas bar alignment, wheel zoom in fullscreen, markers z-index.
- ITI jitter validation tolerance for pre-v0.3.0 protocols.
- Pre-run checklist navigation accuracy and false positive reduction.
- Analytics initialSessions prop overwrite bug.
- Export-all skipped session count.
- Questionnaire designer sticky header prevents name field disappearing.
- Preview now uses actual trial layout colors.

---

## [0.3.0] — 2026-07-12

### Added

#### Experiment design
- **ITI jittering**: Trials support `iti_jitter_ms` and `iti_jitter_distribution` (fixed, uniform, normal, exponential). Jitter applied between trial repetitions at runtime.
- **Randomization constraints**: Blocks support `max_consecutive_same` and `no_immediate_repeat`. Active only when `order_rule` is `random`.
- **Practice blocks**: `is_practice` flag on blocks. Practice trials excluded from analysis windows.
- **Attention check step**: New `attention_check` type for catch trials. Configurable prompt (i18n), expected key, timeout, pass/fail feedback.
- **Screen calibration step**: New `screen_calibration` type with operator checklist and visual angle reference.

#### Templates
- **Stroop task**: 16-trial color-word Stroop with practice block, constrained randomization, jittered ITI.
- **Go/No-Go task**: 40-trial inhibition task (70/30 split) with practice block and jittered ITI.

#### Runtime & branching
- **Performance tracking**: Variables `last_accuracy`, `last_rt_ms`, `cumulative_accuracy`, `last_attention_passed`, `attention_fail_count` for adaptive experiments.
- **BIDS v1.8.0 export**: `bidsBundle()` generates BIDS-compliant behavioral directory structure.
- **Visual angle calculator**: `src/visualAngle.js` with `pixelsPerDegree`, `cmToVisualAngle`, `calibrationReport`, etc.
- **Flow snapshots**: Save/restore/rename/delete named flow states per trial (localStorage, last 20).

---

## [0.2.0] — 2026-07-03

### Added
- Initial public release.
- Visual flow editor with drag-and-drop nodes.
- Block → Trial → Step hierarchy with 4 order rules.
- 11+ step types with multi-language participant content.
- Media support (URL, YouTube, upload).
- Built-in questionnaire designer + external form support.
- Protocol validation, freezing, versioning, hash verification.
- Session runner with recovery, pause/resume, skip/retry.
- ZIP export with events, responses, analysis windows, stimulus manifest, integrity report.
- Analytics dashboard: timeline, response charts, cross-session compare.
- Lab readiness checklist.
- Local-first storage (File System Access API / Tauri desktop).
- Dark mode / light mode + system preference detection.
- Undo/redo, in-app guide panel.
- Emotion experiment template.
