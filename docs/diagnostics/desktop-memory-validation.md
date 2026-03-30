# Desktop Memory Validation

This guide is the low-friction way to validate the desktop viewer memory fix on a real study.

## What you get

- A JSON capture with RSS samples over time
- Manual phase markers you can drop while reproducing the issue
- A self-contained HTML dashboard with:
  - baseline, peak, settled, and final RSS
  - a timeline chart with marker lines
  - a phase-by-phase table
  - a simple verdict on whether memory appears stable, borderline, or still ratcheting upward

## 1. Launch the desktop app from the worktree

The simplest path is the session wrapper:

```bash
cd "/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-memory-fix"
npm run desktop:memory:session
```

That one command will:

- free rebuildable launch artifacts if disk space is too tight
- launch the desktop app
- wait for the Tauri process to appear
- start memory capture automatically
- generate [latest.html](/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-memory-fix/artifacts/desktop-memory/latest.html) when the app closes

If you want the dashboard to open automatically when the run finishes:

```bash
npm run desktop:memory:session -- --open-report
```

If you want to compare decode paths directly, the session wrapper also supports forced decode modes:

```bash
npm run desktop:memory:session -- --decode-mode js --notes "forced JS decode"
npm run desktop:memory:session -- --decode-mode native --decode-debug --notes "forced native decode"
```

`--decode-debug` adds verbose native decode timing and cache logs to [latest-launch.log](/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-memory-fix/artifacts/desktop-memory/latest-launch.log).

You can still type marker labels into the terminal while the session is running.

## 2. Manual launch and capture

Use this path only if you want to launch and capture separately.

```bash
cd "/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-memory-fix"
npm run desktop:launch
```

## 3. Start a capture session

In a second terminal:

```bash
cd "/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-memory-fix"
npm run desktop:memory:capture -- \
  --html artifacts/desktop-memory/latest.html
```

If more than one process matches, rerun with an explicit PID:

```bash
pgrep -fl "dicom-viewer-desktop|myradone"
npm run desktop:memory:capture -- \
  --pid <PID> \
  --html artifacts/desktop-memory/latest.html
```

The npm shortcut adds two safety rails automatically:

- It checkpoints the session to a `.partial.json` file every few seconds while the run is active.
- If free disk space is below 1 GB, it will delete the rebuildable [desktop/src-tauri/target](/Users/gabriel/ai-worktrees/dicom-viewer/codex-desktop-memory-fix/desktop/src-tauri/target) directory before starting the capture.

That `target` cleanup is safe, but the next desktop launch will need to rebuild the native app.

While the capture is running, type marker labels and press Enter. Suggested labels:

- `baseline done`
- `rapid scrub start`
- `rapid scrub stop`
- `idle settle done`
- `series switch start`
- `series switch stop`
- `close viewer`
- `reopen second study`

Press `Ctrl+C` when you are done.

## 4. Reproduce with a real study

Use the same sequence each run so the dashboards stay comparable:

1. Open the large study and wait 30 seconds.
2. Type `baseline done`.
3. Rapidly scrub the slice slider for 60 seconds.
4. Type `rapid scrub stop`.
5. Stop touching the app and wait 60 seconds.
6. Type `idle settle done`.
7. Switch series back and forth 20 to 30 times.
8. Type `series switch stop`.
9. Close the viewer and wait 30 seconds.
10. Type `close viewer`.
11. Reopen a different study and repeat once if needed.

## 5. Open the dashboard

```bash
open artifacts/desktop-memory/latest.html
```

The chart uses numbered marker lines. The markers table below the chart maps each number back to the label you typed during the run.

## How to read the dashboard

- `Baseline` should reflect the early steady state before aggressive interaction.
- `Peak` can spike during scrubbing. That is expected.
- `Settled` is the key metric. It should come back down after you stop interacting.
- `Plateau delta` is settled RSS minus baseline RSS.

Healthy runs usually look like this:

- Peak rises during scrubbing
- Settled RSS drops back near baseline within 30 to 60 seconds
- The final plateau on the second run looks similar to the first one

Suspicious runs usually look like this:

- Settled RSS stays far above baseline after idle time
- Every phase leaves a higher end value than it started with
- The second study settles at a meaningfully higher baseline than the first one

## Optional: regenerate the dashboard later

If you already have a JSON session file, you can rebuild the HTML report without recapturing:

```bash
python3 scripts/desktop-memory-report.py \
  artifacts/desktop-memory/session-20260329-170000.json \
  --output artifacts/desktop-memory/session-20260329-170000.html
```

If a run is interrupted, you can also rebuild the dashboard from the checkpoint file:

```bash
python3 scripts/desktop-memory-report.py \
  artifacts/desktop-memory/session-20260329-170000.partial.json \
  --output artifacts/desktop-memory/recovered.html
```
