# Changelog

All notable changes to PhysioFlow are documented in this file.

## [0.4.0] — 2026-07-12

### Added

#### Simplified export
- **`bundleSimple()`**: New simplified export produces 5 files (down from 10) with human-readable columns. Events use `time_sec` instead of `elapsed_monotonic_ms`, and `step_path` (e.g. "Block 1 / Trial 2 / Fixation") replaces 3 ID columns. Responses and analysis windows also simplified to 7-9 columns each.
- Available as primary export button in runtime completion screen and session manager.

#### Improved i18n coverage
- **230+ translation entries** added for zh (中文) and ja (日本語) across all UI surfaces: flow editor canvas bar, node palette, overflow menu, runtime operator bar, markers panel, session setup, export dialogs, dashboard stats, pre-run checklist, analytics tabs, and more.

### Changed

#### UI/UX redesign
- **Flow editor nodes**: Complete visual redesign — compact 178×55px cards with left color accent, inline rule display (e.g. `if zh = zh`, `repeat ≤ 3×`), centered pill-shaped output ports, hover elevation, and drag feedback.
- **Canvas toolbar**: Single-row fixed-height (34px) bar with auto-wrapping on narrow screens. Overflow items hidden progressively.
- **Collapsible panels**: Left palette and right inspector can be collapsed via toggle buttons. State persisted in localStorage.
- **Collapsible markers**: Runtime marker panel defaults to collapsed. Floating toggle button always visible at bottom-right. Active interval recording shows pulsing indicator.
- **Full-screen node preview**: Double-click or ▸ button on any event node opens full-screen preview. Uses actual trial layout colors (background, text, alignment). Press Esc or click background to close. Removed inline mini-preview from Inspector.
- **Overflow menu**: Grouped sections with clear labels and icons in the ⋯ dropdown.

#### Runtime participant interface
- **Operator bar**: Redesigned — 48px dark bar (`#1a1a2e`), compact controls, clearer status display.
- **Participant view**: Clean centered layout with responsive typography, thinner fixation cross (1.5px), smaller timer ring (140px), larger response buttons with 2px borders and hover states.
- **Questionnaire form**: Card-based fieldset design with scale input hover/selected states, choice list checked state, and proper dark mode.
- **Continue bar**: Removed gradient overlay that obscured content. Button now has standalone shadow.
- **Pause overlay**: Glass-morphism effect with `backdrop-filter: blur(6px)`.

#### CSS architecture
- **Single source of truth**: Node and canvas-bar CSS consolidated from `style.css` + `flow.css` into `style.css`. Removed 200+ lines of duplicate/conflicting rules.
- **Removed duplicates**: `.timer-circle`, `.node-issue-dot`, `.rule-caption`, `.step-card`, `.badge`, `.block`, `.trial` — each now defined exactly once.
- **Dark mode fixes**: Toast notifications now visible in dark mode (was white-on-white). Questionnaire form fields, scale inputs, choice lists, audio player all got dark mode support.
- **CSS audit**: 55+ issues identified and resolved — duplicate selectors, `!important` overrides, hardcoded colors, missing dark-mode variants.

### Fixed

- **Canvas toolbar alignment**: Fixed height, no wrapping, proper vertical centering of all elements.
- **Wheel zoom**: Works in fullscreen mode via document-level listener. Sidebars excluded from zoom.
- **Markers toggle**: Z-index raised above continue bar; collapsed/expanded icon shows correct arrow.
- **Analytics reload**: `initialSessions` prop no longer overwritten by useEffect on mount.
- **Export-all progress**: Skipped sessions (missing protocol snapshot) now reported in progress count.
- **Pre-run checklist**: Navigation accuracy improved; step-type badge resolves protocol indices; 15+ specific Chinese advice categories.
- **ITI jitter validation**: Tolerates missing field on protocols created before v0.3.0 (defaults to 0).
- **Node input port**: Positioned at top-left (13px) — no longer overlaps title text.

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
