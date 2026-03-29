#!/usr/bin/env python3
"""Capture RSS samples for a manual desktop-memory validation run."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import queue
import socket
import subprocess
import sys
import threading
import time
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Capture RSS samples for the desktop app. "
            "Type marker labels and press Enter while the capture is running."
        )
    )
    parser.add_argument(
        "--pid",
        type=int,
        help="PID to monitor. If omitted, the script resolves a process by name.",
    )
    parser.add_argument(
        "--process",
        default="myradone",
        help="Process name fragment to resolve when --pid is not provided. Default: myradone",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Sampling interval in seconds. Default: 1.0",
    )
    parser.add_argument(
        "--duration",
        type=float,
        default=0.0,
        help="Optional capture duration in seconds. Default: run until Ctrl+C or process exit.",
    )
    parser.add_argument(
        "--output",
        help=(
            "Path to the output JSON session file. "
            "Default: artifacts/desktop-memory/session-<timestamp>.json"
        ),
    )
    parser.add_argument(
        "--html",
        help=(
            "Optional path for an HTML dashboard. "
            "If provided, the report is generated automatically after capture."
        ),
    )
    parser.add_argument(
        "--notes",
        default="",
        help="Optional free-form notes stored in the session file.",
    )
    parser.add_argument(
        "--target-plateau-mb",
        type=float,
        default=200.0,
        help="Target settled RSS shown in the report. Default: 200 MB",
    )
    return parser.parse_args()


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False)


def resolve_git_metadata() -> dict[str, str]:
    branch = run_command(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    commit = run_command(["git", "rev-parse", "HEAD"]).stdout.strip()
    return {
        "branch": branch,
        "commit": commit,
    }


def default_output_path() -> pathlib.Path:
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    return pathlib.Path("artifacts") / "desktop-memory" / f"session-{timestamp}.json"


def ensure_parent(path: pathlib.Path) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def resolve_process(pid: int | None, process_name: str) -> tuple[int, str]:
    if pid is not None:
        snapshot = sample_process(pid)
        if snapshot is None:
            raise SystemExit(f"Process with PID {pid} is not running.")
        return pid, snapshot["command"]

    result = run_command(["pgrep", "-fl", process_name])
    candidates: list[tuple[int, str]] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) < 2:
            continue
        candidate_pid = int(parts[0])
        command = parts[1]
        if process_name.lower() not in command.lower():
            continue
        candidates.append((candidate_pid, command))

    if not candidates:
        raise SystemExit(
            f'No running process matched "{process_name}". '
            "Start the desktop app first or pass --pid."
        )

    if len(candidates) > 1:
        formatted = "\n".join(f"  {candidate_pid}: {command}" for candidate_pid, command in candidates)
        raise SystemExit(
            f'Multiple processes matched "{process_name}". Pass --pid to choose one:\n{formatted}'
        )

    return candidates[0]


def sample_process(pid: int) -> dict[str, Any] | None:
    result = run_command(["ps", "-o", "rss=,vsz=,%cpu=,etime=,comm=", "-p", str(pid)])
    output = result.stdout.strip()
    if result.returncode != 0 or not output:
        return None

    parts = output.split(None, 4)
    if len(parts) < 5:
        return None

    return {
        "rss_kb": int(parts[0]),
        "vsz_kb": int(parts[1]),
        "cpu_percent": float(parts[2]),
        "elapsed": parts[3],
        "command": parts[4],
    }


def print_instructions(pid: int, command: str, output_path: pathlib.Path, html_path: pathlib.Path | None) -> None:
    print(f"Monitoring PID {pid}: {command}")
    print(f"Writing session data to {output_path}")
    if html_path is not None:
        print(f"Dashboard will be written to {html_path} after capture")
    if sys.stdin.isatty():
        print('Type a marker label and press Enter while the capture is running.')
        print('Examples: "baseline done", "rapid scrub start", "rapid scrub stop", "close viewer".')
    print("Press Ctrl+C to stop.\n")


def start_marker_reader(marker_queue: queue.Queue[str]) -> None:
    if not sys.stdin.isatty():
        return

    def reader() -> None:
        while True:
            line = sys.stdin.readline()
            if not line:
                return
            marker_queue.put(line.rstrip("\n"))

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()


def build_session_metadata(
    pid: int,
    process_name: str,
    resolved_command: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    git = resolve_git_metadata()
    return {
        "schema_version": 1,
        "captured_at": utc_now_iso(),
        "host": socket.gethostname(),
        "cwd": str(pathlib.Path.cwd()),
        "pid": pid,
        "process_name": process_name,
        "resolved_command": resolved_command,
        "interval_seconds": args.interval,
        "duration_seconds": args.duration,
        "notes": args.notes,
        "target_plateau_mb": args.target_plateau_mb,
        "git_branch": git["branch"],
        "git_commit": git["commit"],
    }


def write_session_file(path: pathlib.Path, session: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(session, handle, indent=2)
        handle.write("\n")


def maybe_generate_report(
    session_path: pathlib.Path,
    html_path: pathlib.Path | None,
    target_plateau_mb: float,
) -> None:
    if html_path is None:
        return

    report_script = pathlib.Path(__file__).with_name("desktop-memory-report.py")
    result = run_command(
        [
            sys.executable,
            str(report_script),
            str(session_path),
            "--output",
            str(html_path),
            "--target-plateau-mb",
            str(target_plateau_mb),
        ]
    )
    if result.returncode != 0:
        print(result.stdout, end="")
        print(result.stderr, end="", file=sys.stderr)
        raise SystemExit(f"Failed to generate HTML report at {html_path}")


def main() -> None:
    args = parse_args()
    output_path = ensure_parent(pathlib.Path(args.output) if args.output else default_output_path())
    html_path = ensure_parent(pathlib.Path(args.html)) if args.html else None

    pid, resolved_command = resolve_process(args.pid, args.process)
    print_instructions(pid, resolved_command, output_path, html_path)

    marker_queue: queue.Queue[str] = queue.Queue()
    start_marker_reader(marker_queue)

    started_at = time.time()
    samples: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = [
        {
            "time_seconds": 0.0,
            "label": "Capture start",
            "source": "system",
        }
    ]

    marker_count = 0
    stop_reason = "manual-stop"

    try:
        while True:
            now = time.time()
            time_seconds = round(now - started_at, 3)
            snapshot = sample_process(pid)
            if snapshot is None:
                stop_reason = "process-exited"
                markers.append(
                    {
                        "time_seconds": time_seconds,
                        "label": "Process exited",
                        "source": "system",
                    }
                )
                break

            samples.append(
                {
                    "timestamp": utc_now_iso(),
                    "time_seconds": time_seconds,
                    **snapshot,
                }
            )

            while not marker_queue.empty():
                raw_label = marker_queue.get_nowait().strip()
                marker_count += 1
                label = raw_label or f"Marker {marker_count}"
                markers.append(
                    {
                        "time_seconds": time_seconds,
                        "label": label,
                        "source": "manual",
                    }
                )
                print(f"[marker @ {time_seconds:7.1f}s] {label}")

            if args.duration > 0 and time_seconds >= args.duration:
                stop_reason = "duration-reached"
                markers.append(
                    {
                        "time_seconds": time_seconds,
                        "label": "Duration reached",
                        "source": "system",
                    }
                )
                break

            time.sleep(max(args.interval, 0.1))
    except KeyboardInterrupt:
        stop_reason = "keyboard-interrupt"
        markers.append(
            {
                "time_seconds": round(time.time() - started_at, 3),
                "label": "Capture stopped",
                "source": "system",
            }
        )
        print("\nStopping capture...")

    session = build_session_metadata(pid, args.process, resolved_command, args)
    session.update(
        {
            "stop_reason": stop_reason,
            "sample_count": len(samples),
            "samples": samples,
            "markers": markers,
        }
    )
    write_session_file(output_path, session)
    maybe_generate_report(output_path, html_path, args.target_plateau_mb)

    print(f"Saved {len(samples)} samples to {output_path}")
    if html_path is not None:
        print(f"Saved dashboard to {html_path}")


if __name__ == "__main__":
    main()
