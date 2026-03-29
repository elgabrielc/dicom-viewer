#!/usr/bin/env python3
"""Capture RSS samples for a manual desktop-memory validation run."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import queue
import shutil
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
    parser.add_argument(
        "--checkpoint-interval",
        type=float,
        default=5.0,
        help="How often to checkpoint the capture to disk in seconds. Default: 5.0",
    )
    parser.add_argument(
        "--ensure-free-mb",
        type=float,
        default=0.0,
        help="Minimum free disk space required before capture starts. Default: 0",
    )
    parser.add_argument(
        "--cleanup-path",
        action="append",
        default=[],
        help=(
            "Optional rebuildable path to delete if free disk space is below --ensure-free-mb. "
            "Can be passed multiple times."
        ),
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


def bytes_to_mb(value: int | float) -> float:
    return float(value) / (1024.0 * 1024.0)


def resolve_path(raw_path: str) -> pathlib.Path:
    path = pathlib.Path(raw_path).expanduser()
    if path.is_absolute():
        return path
    return pathlib.Path.cwd() / path


def resolve_cleanup_paths(raw_paths: list[str]) -> list[pathlib.Path]:
    resolved_paths: list[pathlib.Path] = []
    seen: set[str] = set()
    for raw_path in raw_paths:
        path = resolve_path(raw_path).resolve(strict=False)
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        resolved_paths.append(path)
    return resolved_paths


def existing_anchor(path: pathlib.Path) -> pathlib.Path:
    current = path.resolve(strict=False)
    while not current.exists() and current != current.parent:
        current = current.parent
    return current


def free_space_bytes(path: pathlib.Path) -> int:
    anchor = existing_anchor(path)
    return shutil.disk_usage(anchor).free


def estimate_path_size_bytes(path: pathlib.Path) -> int:
    if not path.exists():
        return 0

    result = run_command(["du", "-sk", str(path)])
    if result.returncode == 0:
        output = result.stdout.strip()
        if output:
            size_kb = output.split()[0]
            if size_kb.isdigit():
                return int(size_kb) * 1024

    if path.is_file():
        return path.stat().st_size

    total = 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            continue
    return total


def remove_path(path: pathlib.Path) -> None:
    if not path.exists():
        return
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    shutil.rmtree(path)


def ensure_free_space(
    root: pathlib.Path,
    minimum_free_mb: float,
    cleanup_paths: list[pathlib.Path],
) -> dict[str, Any]:
    free_before_bytes = free_space_bytes(root)
    summary: dict[str, Any] = {
        "required_free_mb": round(minimum_free_mb, 1),
        "free_before_mb": round(bytes_to_mb(free_before_bytes), 1),
        "free_after_mb": round(bytes_to_mb(free_before_bytes), 1),
        "cleanup_actions": [],
        "satisfied": True,
    }
    if minimum_free_mb <= 0:
        return summary

    required_bytes = int(minimum_free_mb * 1024.0 * 1024.0)
    if free_before_bytes >= required_bytes:
        return summary

    print(
        "Free space is low "
        f"({bytes_to_mb(free_before_bytes):.1f} MB available, {minimum_free_mb:.1f} MB required)."
    )

    for cleanup_path in cleanup_paths:
        action: dict[str, Any] = {
            "path": str(cleanup_path),
            "status": "missing",
        }
        if cleanup_path.exists():
            estimated_size_mb = round(bytes_to_mb(estimate_path_size_bytes(cleanup_path)), 1)
            print(
                f"Removing rebuildable path {cleanup_path} "
                f"(about {estimated_size_mb:.1f} MB) to recover space..."
            )
            remove_path(cleanup_path)
            free_after_action = free_space_bytes(root)
            action = {
                "path": str(cleanup_path),
                "status": "removed",
                "estimated_size_mb": estimated_size_mb,
                "free_after_mb": round(bytes_to_mb(free_after_action), 1),
            }
            if free_after_action >= required_bytes:
                summary["cleanup_actions"].append(action)
                summary["free_after_mb"] = round(bytes_to_mb(free_after_action), 1)
                return summary
        summary["cleanup_actions"].append(action)

    free_after_bytes = free_space_bytes(root)
    summary["free_after_mb"] = round(bytes_to_mb(free_after_bytes), 1)
    summary["satisfied"] = free_after_bytes >= required_bytes
    if summary["satisfied"]:
        return summary

    cleanup_hint = ""
    if cleanup_paths:
        cleanup_hint = " Cleanup paths were attempted but did not free enough space."
    raise SystemExit(
        "Not enough free disk space to start capture. "
        f"Available: {bytes_to_mb(free_after_bytes):.1f} MB. "
        f"Required: {minimum_free_mb:.1f} MB."
        f"{cleanup_hint}"
    )


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


def checkpoint_path_for(output_path: pathlib.Path) -> pathlib.Path:
    if output_path.suffix:
        return output_path.with_name(f"{output_path.stem}.partial{output_path.suffix}")
    return output_path.with_name(f"{output_path.name}.partial.json")


def print_instructions(
    pid: int,
    command: str,
    output_path: pathlib.Path,
    checkpoint_path: pathlib.Path,
    html_path: pathlib.Path | None,
) -> None:
    print(f"Monitoring PID {pid}: {command}")
    print(f"Writing session data to {output_path}")
    print(f"Checkpointing live data to {checkpoint_path}")
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
    disk_guard: dict[str, Any],
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
        "disk_guard": disk_guard,
    }


def write_session_file(path: pathlib.Path, session: dict[str, Any]) -> None:
    temp_path = path.with_name(f".{path.name}.tmp")
    try:
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(session, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


class CheckpointWriter:
    def __init__(self, output_path: pathlib.Path, interval_seconds: float) -> None:
        self.output_path = output_path
        self.checkpoint_path = checkpoint_path_for(output_path)
        self.interval_seconds = max(interval_seconds, 0.0)
        self.last_write_monotonic = 0.0
        self.warning_emitted = False

    def maybe_write(self, session: dict[str, Any], force: bool = False) -> None:
        now = time.monotonic()
        if not force and self.interval_seconds > 0 and (now - self.last_write_monotonic) < self.interval_seconds:
            return
        self._write_checkpoint(session, now)

    def _write_checkpoint(self, session: dict[str, Any], now: float) -> None:
        try:
            write_session_file(self.checkpoint_path, session)
        except OSError as exc:
            if not self.warning_emitted:
                print(
                    f"Warning: failed to write checkpoint {self.checkpoint_path}: {exc}",
                    file=sys.stderr,
                )
                self.warning_emitted = True
            return

        self.last_write_monotonic = now
        self.warning_emitted = False

    def finalize(self, session: dict[str, Any]) -> pathlib.Path:
        write_session_file(self.checkpoint_path, session)
        os.replace(self.checkpoint_path, self.output_path)
        self.last_write_monotonic = time.monotonic()
        self.warning_emitted = False
        return self.output_path


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
    cleanup_paths = resolve_cleanup_paths(args.cleanup_path)
    disk_guard = ensure_free_space(output_path, args.ensure_free_mb, cleanup_paths)

    pid, resolved_command = resolve_process(args.pid, args.process)
    checkpoint_writer = CheckpointWriter(output_path, args.checkpoint_interval)
    print_instructions(pid, resolved_command, output_path, checkpoint_writer.checkpoint_path, html_path)

    marker_queue: queue.Queue[str] = queue.Queue()
    start_marker_reader(marker_queue)

    started_at = time.time()
    session = build_session_metadata(pid, args.process, resolved_command, args, disk_guard)
    session.update(
        {
            "stop_reason": "running",
            "sample_count": 0,
            "samples": [],
            "markers": [
                {
                    "time_seconds": 0.0,
                    "label": "Capture start",
                    "source": "system",
                }
            ],
            "checkpoint_path": str(checkpoint_writer.checkpoint_path),
            "last_updated_at": utc_now_iso(),
        }
    )
    checkpoint_writer.maybe_write(session, force=True)

    marker_count = 0

    try:
        while True:
            now = time.time()
            time_seconds = round(now - started_at, 3)
            snapshot = sample_process(pid)
            if snapshot is None:
                session["stop_reason"] = "process-exited"
                session["markers"].append(
                    {
                        "time_seconds": time_seconds,
                        "label": "Process exited",
                        "source": "system",
                    }
                )
                break

            session["samples"].append(
                {
                    "timestamp": utc_now_iso(),
                    "time_seconds": time_seconds,
                    **snapshot,
                }
            )
            session["sample_count"] = len(session["samples"])
            session["last_updated_at"] = utc_now_iso()

            wrote_marker = False
            while not marker_queue.empty():
                raw_label = marker_queue.get_nowait().strip()
                marker_count += 1
                label = raw_label or f"Marker {marker_count}"
                session["markers"].append(
                    {
                        "time_seconds": time_seconds,
                        "label": label,
                        "source": "manual",
                    }
                )
                wrote_marker = True
                print(f"[marker @ {time_seconds:7.1f}s] {label}")

            if args.duration > 0 and time_seconds >= args.duration:
                session["stop_reason"] = "duration-reached"
                session["markers"].append(
                    {
                        "time_seconds": time_seconds,
                        "label": "Duration reached",
                        "source": "system",
                    }
                )
                break

            checkpoint_writer.maybe_write(session, force=wrote_marker)
            time.sleep(max(args.interval, 0.1))
    except KeyboardInterrupt:
        session["stop_reason"] = "keyboard-interrupt"
        session["markers"].append(
            {
                "time_seconds": round(time.time() - started_at, 3),
                "label": "Capture stopped",
                "source": "system",
            }
        )
        print("\nStopping capture...")

    session["sample_count"] = len(session["samples"])
    session["last_updated_at"] = utc_now_iso()
    session["captured_finished_at"] = utc_now_iso()
    checkpoint_writer.finalize(session)
    if session["sample_count"] > 0:
        maybe_generate_report(output_path, html_path, args.target_plateau_mb)
    elif html_path is not None:
        print("Skipped dashboard generation because the capture recorded no samples.", file=sys.stderr)

    print(f"Saved {session['sample_count']} samples to {output_path}")
    if html_path is not None and session["sample_count"] > 0:
        print(f"Saved dashboard to {html_path}")


if __name__ == "__main__":
    main()
