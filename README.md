# PhysioFlow

Local-first visual experiment workflow system for behavioral and physiological research. Design protocols, run sessions, and export analysis-ready data — all from one desktop app or browser.

## 📥 Download (Recommended)

Download the desktop app — no browser, no terminal, just double-click:

| Platform | Download | Version |
|----------|----------|---------|
| **Windows** | [PhysioFlow-Setup.exe](https://github.com/kyzzz22/physioflow-app/releases/download/v0.6.0-beta.3/PhysioFlow_0.6.0-beta.3_x64-setup.exe) | v0.6.0-beta.3 |
| **macOS** | [PhysioFlow.dmg](https://github.com/kyzzz22/physioflow-app/releases/latest) | v0.6.0-beta.3 *(macOS build pending)* |

The desktop app stores data directly in `~/Documents/PhysioFlow Data` (macOS) or `Documents\PhysioFlow Data` (Windows). Click **Open folder** on the dashboard to reveal it in Finder/File Explorer.

> **Why the desktop app?** It handles file storage natively — no browser permissions needed. Data stays in a folder you control, ready to back up or move.

## What's new in v0.6.0-beta.3

- **Pre-run media gate**: referenced local media and checksums are verified before a Graph session can start; missing files now produce an actionable error instead of a blank stimulus.
- **Visible recovery failures**: both runtimes serialize recovery writes and show a retry control when a checkpoint cannot be saved.
- **Required-device preflight**: device-backed runs block on connection or adapter errors by default, with an explicit opt-out in the node inspector.
- **Safer desktop writes and Custom HTML**: desktop files use replace-safe temporary writes, and legacy/V2 Custom HTML now share a script-disabled sandbox.

### Included from v0.6.0-beta.2

- **Drag that stays tidy**: in the participant-screen editor, dragging an element auto-switches its container to a free layout and aligns the other elements to the 8px grid — no more elements jumping to (0,0) or scattering. An **Auto arrange** button re-tidies any screen in one click.
- **Cleaner node inspector**: primary settings are open by default, dev telemetry stays out of Quick mode, and Questionnaire/Wait nodes open preview-only (their screens are generated at run time).
- **Shared stimulus pools**: preserve protocol flow while assigning media in a reproducible random order without replacement
- **Participant UI editing**: dedicated full-screen editor with synchronized node/runtime configuration
- **Researcher-ready questionnaires**: graphical SAM choices and a live participant preview
- **Safer protocol editing**: improved full JSON editor, complete pre-run validation, and clearer validation messages
- **Local media workflow**: upload, preview, validate, and run image/audio/video assets without hosting them first

- **Questionnaire overhaul**: drag-and-drop reorder, conditional skip logic, 11 presets (SAM, Likert, NPS, VAS...), auto-scoring, VAS slider, random order, progress bar, CSV batch import
- **Full-screen preview + inline editing**: double-click any node to preview as participant sees it; toggle ✎ Edit to modify content, questionnaire, media, timing directly
- **Flow editor undo/redo**: Ctrl+Z / Ctrl+Shift+Z for all node operations
- **Simplified export**: 5 files with clean human-readable columns (standard + BIDS formats)
- **Stroop and Go/No-Go templates**: configurable trial count, go ratio, ITI jitter, practice block
- **ITI jittering** with 4 distributions + randomization constraints
- **Practice block** + **attention check** + **screen calibration** step types
- **Performance-based branching**: runtime variables (accuracy, RT) usable in Condition nodes
- **Visual angle calculator**: `pixelsPerDegree`, `calibrationReport`, etc.
- **Flow snapshots** + **300+ zh/ja i18n entries**

See [CHANGELOG.md](./CHANGELOG.md) for the full history.

Roadmap & remaining work (incl. the human usability study gate): [docs/refactor/OPTIMIZATION_PLAN.md](./docs/refactor/OPTIMIZATION_PLAN.md) — §0 status snapshot + §9 follow-up list.

## Operator workflow

1. **Download & open** the desktop app, or run the web version.
2. Create a protocol, import JSON, or start from a template (Emotion, Stroop, Go/No-Go).
3. Use Blocks & Trials for hierarchy, randomization constraints, ITI jitter, and practice flags.
4. Open the visual editor — add event nodes, connect ports, use Condition/Loop for branches.
5. Attach media, configure questionnaires, add attention checks, mark analysis windows.
6. Validate, freeze, select a local data folder, start a formal session.
7. Export the session ZIP (standard or simplified format) and keep it with device recordings.

## Step types

| Type | Description |
|------|-------------|
| `instruction` | Participant-facing text before or between tasks |
| `fixation` | Centered cross for baseline / gaze reset |
| `timer` | Countdown without media or questionnaire |
| `video` | Local, URL, or YouTube video stimulus |
| `audio` | Sound stimulus with media lifecycle events |
| `image` | Still image stimulus |
| `questionnaire` | Built-in designer with presets, scoring, conditional logic |
| `response` | Single quick button / keyboard response with RT |
| `attention_check` | Catch trial with expected keypress and pass/fail feedback |
| `manual_event` | Operator-confirmed external event |
| `device_check` | Operator checklist for sensors and setup |
| `rest` | Recovery period between trials or stimuli |
| `screen_calibration` | Pre-experiment display calibration with visual angle reference |

### Control nodes

| Node | Description |
|------|-------------|
| `start` | Entry point for the trial flow |
| `condition` | Branches on true/false using participant fields, answers, or performance variables |
| `loop` | Repeats body path until rule fails or max iterations reached |
| `end` | Stops current trial and advances to next unit |
| `note` | Sticky note (visual only, ignored at runtime) |
| `junction` | Wire routing node |

### Performance variables (Condition nodes)

| Variable | Description |
|----------|-------------|
| `last_accuracy` / `cumulative_accuracy` | Response accuracy (true/false, running ratio) |
| `last_rt_ms` | Most recent reaction time in ms |
| `last_attention_passed` | Whether last attention check passed |
| `attention_fail_count` / `attention_total_count` | Attention check stats |

## Task templates

- **Emotion**: Five-condition (HVHA/LVHA/LVLA/HVLA/NVLA) with SAM questionnaire, video stimuli, analysis windows
- **Stroop**: Color-word task, configurable trials/practice/jitter
- **Go/No-Go**: Inhibition task, configurable go ratio (50-90%), trials, practice, jitter

## Export formats

Each session exports a ZIP. **Simplified** (default, 5 files) or **Complete** (10 files):

| Simplified | Complete | Description |
|-----------|----------|-------------|
| `events.csv` (8 cols) | `events.csv` (23 cols) | Timeline of every step, marker, media event |
| `responses.csv` (7 cols) | `responses.csv` (15 cols) | Questionnaire answers with scoring |
| `analysis_windows.csv` (9 cols) | `analysis_windows.csv` (18 cols) | Derived physiology intervals |
| `session.json` | `session.json` | Metadata + integrity summary |
| `protocol.json` | `protocol.json` | Protocol configuration used |
| — | `integrity_report.json` | Automated quality checks |
| — | `data_dictionary.csv` | Field-level descriptions |

**BIDS v1.8.0** format also available for neuroimaging pipeline compatibility.

## Data & privacy

- Desktop mode writes everything to `~/Documents/PhysioFlow Data`.
- Web local-folder mode uses the browser File System Access API (Chrome/Edge).
- No account, email, or personal data collected. Use anonymous participant IDs.
- Each export is a self-contained ZIP — protocol, events, responses, analysis windows.

## Developer setup

```bash
# Clone and install
git clone https://github.com/kyzzz22/physioflow-app.git
cd physioflow-app
npm install

# Web dev server
npm run dev          # → http://localhost:5174

# Desktop app
npm run desktop:dev  # Tauri hot-reload
npm run desktop:build  # → src-tauri/target/release/bundle/

# Tests & lint
npm test             # 332 total (331 passed, 1 skipped on Windows: symlink helper)
npm run lint         # ESLint
npm run quality:release  # build + lint + all tests and browser gates
```

For a single-node hosted service with the public `/participant` application, atomic state persistence, and signed filesystem assets, see [Single-Node Self-Hosting](./docs/refactor/SELF_HOSTING.md).
