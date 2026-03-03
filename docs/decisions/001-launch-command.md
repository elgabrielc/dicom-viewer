# ADR 001: launch.command Startup for Personal macOS Use

## Status
Accepted (file exists in working tree, pending commit)

## Context

The user wanted the app to work "like Horos" -- put DICOMs in a folder once, double-click to launch, everything is there. The existing workflow required five steps: open a terminal, navigate to the project directory, activate a Python venv, run `python app.py`, and manually open `http://127.0.0.1:5001/` in a browser. Too much friction for a personal tool meant for daily use.

This was one of three pillars of the Persistent Local DICOM Library feature (PR 1: backend library API, PR 2: frontend auto-load, PR 3: this launcher). The launcher eliminates startup friction while the library feature eliminates the need to re-import images each session.

Related: Session 2026-02-24 ("Persistent Local DICOM Library -- Architecture and Planning").

## Decision

Use a macOS `.command` script as the startup entry point. The `.command` extension is a macOS convention: Terminal.app automatically opens and executes these files when double-clicked in Finder.

The script launches Flask, detects the port from server output, waits for readiness, opens the browser, and cleans up on exit.

## Alternatives Considered

- **Plain `.sh` script** (initial proposal): Rejected after two independent reviewers flagged the same problem -- macOS opens `.sh` files in a text editor by default, not in Terminal. This was rated P2 in plan review. The `.command` extension is the standard fix.

- **Automator `.app` wrapper**: Considered as an alternative to `.command`. Rejected as more complex to create and maintain for what is a developer convenience, not a product feature.

- **Electron or Tauri desktop wrapper**: Briefly considered as part of the broader "like Horos" architecture discussion. Rejected as massive overkill -- the user's request was for something "extremely simple and dirty."

- **Opening browser before server starts**: One counter-plan proposed `open "http://..." &` before `flask run`. Flagged because it would show a connection error briefly. This led to the wait-loop design where the browser only opens after the server confirms readiness.

- **`flask run` instead of `python app.py`**: A counter-plan proposed this. Rejected because it requires `FLASK_APP` to be set, and the app calls `app.run()` directly.

## Design Details

The script (42 lines) includes several deliberate choices:

- **Port detection via log parsing**: Rather than hardcoding port 5001, the script redirects Flask output to a temp file and parses the "Running on http://..." line with grep. This handles port conflicts gracefully.

- **15-second timeout with health checks**: A wait loop checks every 0.5 seconds for the port, with `kill -0 $PID` verifying Flask is still alive before each check. If Flask dies, the script shows the log output for debugging and exits with code 1. Prevents hanging indefinitely.

- **Venv activation with fallback**: `source venv/bin/activate 2>/dev/null || true` attempts the venv but doesn't fail if it's missing (the user might have packages installed globally).

- **`cd "$(dirname "$0")`**: Changes to the script's own directory so it works regardless of where Finder launches it from (Finder's default working directory is `~`).

- **Trap for cleanup**: `trap "kill $PID $TAIL_PID 2>/dev/null; rm -f $LOGFILE" EXIT` ensures the Flask server and log tail are killed and the temp file is removed when the Terminal window closes.

- **Background log tailing**: After detecting the port, `tail -f "$LOGFILE" &` streams Flask output to the terminal so the user can see server activity.

## Review Iterations

The plan went through 5 major revisions with 2 external critique cycles:

1. **V1**: Proposed `launch.sh`, ~15 lines, naive approach.
2. **Critique 1**: Reviewer flagged `.sh` won't double-click on macOS -- needs `.command` or Automator.
3. **V2**: Switched to `.command` extension.
4. **Critique 2**: Second reviewer independently confirmed the `.sh` problem.
5. **Counter-plans**: One proposed a 4-PR structure with auth-ready seams (rejected as over-engineered). Another proposed a cleaner version that was praised but needed adjustments: POST for refresh, `python app.py` not `flask run`, wait loop before opening browser.
6. **Final plan**: ~10 lines with `curl` wait loop and trap.

The actual implementation (42 lines by Codex) is more robust than the final plan specified, adding port detection from log parsing, process health checks, and background log tailing.

## Consequences

Positive:
- Personal startup becomes a single double-click in Finder.
- No changes to Flask architecture or dependencies.
- Eliminates 5 manual steps from the daily workflow.

Negative:
- macOS-specific -- won't help on Linux or Windows.
- Must stay aligned with Flask startup behavior (port selection, output format).
