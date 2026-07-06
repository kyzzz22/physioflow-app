# PhysioFlow

Independent visual experiment workflow system for behavioral and physiological research. It provides a local-first protocol builder, visual trial flow editor, runtime runner, recovery support, session export, and analytics entry point.

## Run locally

```bash
npm run dev
```

Open `http://localhost:5174`. Production verification uses `npm run build`; unit/business tests use `npm test` and static checks use `npm run lint`.

Optional browser smoke test:

```bash
npm run dev
# In another terminal, open Chrome with --remote-debugging-port=9222 and http://localhost:5174
npm run test:e2e
```

The smoke test verifies that frozen/formal collection is blocked until a local data folder is selected, while draft preview sessions can still run with browser fallback storage.

## Lightweight distribution

```bash
npm run build
npm run package:web
```

`npm run package:web` creates:

- `release-web/PhysioFlow-Web-v0.2.0/`: a static folder that must be served by the included launch script or any static server.
- `release-web/PhysioFlow-Web-v0.2.0.zip`: a small portable ZIP containing only web assets and launch scripts.

Do not double-click `index.html` directly. Modern browsers can block module scripts from `file://` pages and show a blank screen. Unzip the package and use the included launcher; it starts a local static server, chooses an available local port, then opens the browser.

The generated folder includes helper launchers:

- Safe instruction page: double-click `START_HERE.html`.
- Windows: double-click `start-windows.bat`.
- macOS: double-click `start-mac.command`; if blocked, run `chmod +x start-mac.command`.
- Linux: run `sh start-linux.sh`.

These launchers use Python's built-in static server. If Python is unavailable, serve the folder with any static web server. Browser storage is tied to the origin, so keep the same URL such as `http://127.0.0.1:8080/` for the same lab computer. Before distributing any build, run one test session, export its ZIP, and confirm the generated `integrity_report.json` does not show unexpected invalid windows.
If port `8080` is busy, the launcher automatically tries the next available local port up to `8099`.

## Local Data Folder

PhysioFlow is designed to save experiment data into a user-selected local folder, not browser cache. On the dashboard, click `Data folder` or `Select folder`, choose a folder such as `Documents/PhysioFlow Data`, and approve write access. The app writes:

- `projects/*.json`: protocol drafts and frozen versions.
- `sessions/<participant_date_id>/`: session package files plus `session_detail.json`.
- `assets/*.bin` and `assets/*.meta.json`: uploaded video/audio/image files and checksums.
- `current_run.json`: recovery snapshot for an interrupted run.

This local folder mode uses the browser File System Access API and works best in Chrome or Edge. If a browser does not support folder access, the app warns on the dashboard and falls back to browser-managed storage for drafts and previews. Frozen/formal sessions are blocked until a local folder is selected, so completed formal data is not stored only in browser cache.

## Click-To-Use Desktop App

For users who should not open a browser or start a local server, build the Tauri desktop app:

```bash
npm run desktop:build
```

The desktop app opens with a normal double click and stores data directly in:

```text
~/Documents/PhysioFlow Data
```

The folder contains `projects/`, `sessions/`, `assets/`, and `current_run.json`. This is the recommended mode for handing the tool to non-technical users.

In the desktop app, the dashboard storage banner includes `Open folder`, which reveals the active data directory in Finder/File Explorer.

## Operator workflow

1. Create a new protocol, import a protocol JSON, or start from the emotion template.
2. Use Blocks & Trials to set hierarchy, repeat counts, order rules, and trial conditions.
3. Open the visual editor, add event nodes, connect output ports, and use Condition or Loop nodes only when the path branches or repeats.
4. Attach media, fill participant content, configure questionnaires, and enable Generate analysis window on intervals needed for physiology analysis.
5. Run the protocol check, freeze the version for reproducibility, select a local data folder, then start a formal session.
6. Export the session ZIP and keep it with the original device recordings.

The app also includes an in-app Guide panel from the dashboard and visual editor toolbar. It summarizes the workflow, node types, and output files for new users.

## Lab readiness checklist

The dashboard includes a Lab readiness summary for each project and the whole workspace. It checks the practical handoff conditions that matter before formal collection:

- valid protocol structure and no blocking validation errors
- participant-facing content and questionnaire configuration
- media sources for every video/audio/image step
- at least one analysis window for physiology alignment
- frozen protocol hash for reproducibility
- at least one completed pilot/formal session
- local data storage selected or desktop storage available

Use this checklist before handing the app to another operator or exporting formal data.

## Data and privacy

- Desktop mode writes protocols, sessions, recovery snapshots, and uploaded media to `~/Documents/PhysioFlow Data`.
- Web local-folder mode writes protocols, sessions, recovery snapshots, and uploaded media to the folder selected from the dashboard.
- Browser-managed `localStorage` and `IndexedDB` are fallback storage for drafts and preview runs only when local folder access is unavailable or not selected.
- Frozen/formal sessions require desktop storage or a selected local data folder before the run can start.
- No account, name, email, or student number is collected by default. Researchers should use anonymous participant IDs.
- Deleting a Session requires typing its participant ID. Clearing browser site data also removes locally stored experiments and uploads.
- Each export is one ZIP containing protocol, Session metadata, raw events, responses, analysis windows, stimulus manifest, integrity report, and data dictionary.

## Export data format

Each completed or aborted session exports a ZIP with these files:

- `session.json`: session metadata, participant ID, sync settings, run status, and integrity summary.
- `export_manifest.json`: machine-readable package manifest, generation time, IDs, and record counts.
- `README.txt`: human-readable notes for the exported session package.
- `protocol.json`: the exact protocol snapshot used for the session.
- `events.csv`: append-only log for block/trial/step entry, completion, media events, pause/resume, skip/retry, manual markers, and graph node IDs.
- `responses.csv`: one row per submitted questionnaire answer.
- `analysis_windows.csv`: derived intervals for steps marked as analysis windows, including duration, validity status, pause count, and overlapping markers.
- `stimulus_manifest.csv`: media source information, upload IDs, filenames, checksums, and metadata.
- `integrity_report.json`: automated checks for continuity, missing end events, invalid windows, and timing attention flags.
- `data_dictionary.csv`: field descriptions for the CSV files and manifest.

## Timing scope

The runtime records `Date.now()` epoch milliseconds for external-clock alignment and `performance.now()` monotonic milliseconds for internal durations. It is suitable for browser-based behavioral and physiological experiment orchestration, but it is not a hard real-time acquisition system. Browser scheduling, display refresh, media decoding, operating-system load, and network playback can introduce latency. Direct/local HTML media exposes actual play/end events; YouTube iframe playback cannot be verified with the same precision and is explicitly exported with `attention / youtube_playback_unverified`.

For high-precision device alignment, record a manual sync marker or measured offset and retain the device's original continuous data. The Session export preserves sync method, offset, time-column format, timezone, and sampling-rate metadata.

## Recovery behavior

Every event node can choose how an interrupted run recovers: resume remaining time, restart the event, or wait for the operator. Recovery snapshots preserve the graph node, append-only event history, answers, remaining fixed duration, pause state, and active interval marker without emitting a duplicate `step_entered` event.
