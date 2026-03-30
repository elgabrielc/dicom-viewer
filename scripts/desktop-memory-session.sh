#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARTIFACT_DIR="${REPO_ROOT}/artifacts/desktop-memory"
LAUNCH_LOG_PATH="${ARTIFACT_DIR}/latest-launch.log"
DEFAULT_HTML_PATH="${ARTIFACT_DIR}/latest.html"
DEFAULT_MIN_FREE_MB="${DICOM_MEMORY_MIN_FREE_MB:-1024}"
LAUNCH_TIMEOUT_SECONDS="${DICOM_MEMORY_LAUNCH_TIMEOUT_SECONDS:-300}"
DESKTOP_BINARY_PATTERN="${DICOM_MEMORY_PROCESS_PATTERN:-src-tauri/target/debug/dicom-viewer-desktop}"
DESKTOP_PROCESS_NAME="${DICOM_MEMORY_PROCESS_NAME:-dicom-viewer-desktop}"
REBUILDABLE_TARGET_PATH="${REPO_ROOT}/desktop/src-tauri/target"

LAUNCH_PID=""
OPEN_REPORT=0
LAUNCH_ARGS=()
CAPTURE_ARGS=()

usage() {
  cat <<EOF
Usage: npm run desktop:memory:session -- [wrapper options] [capture options]

Launch the desktop app, wait for the Tauri process, and start RSS capture automatically.

Examples:
  npm run desktop:memory:session
  npm run desktop:memory:session -- --notes "rapid scrub run"
  npm run desktop:memory:session -- --open-report
  npm run desktop:memory:session -- --decode-mode js --notes "forced JS repro"
  npm run desktop:memory:session -- --decode-mode native --decode-debug --notes "forced native repro"
  npm run desktop:memory:session -- --decode-trace --notes "trace scrub repro"
  npm run desktop:memory:session -- --preload-mode off --notes "viewer preload off repro"

Wrapper options:
  --open-report   Open the generated HTML dashboard when the run finishes.
  --decode-mode   Set desktop decode experiment mode: auto, js, or native.
  --preload-mode Set viewer preload experiment mode: auto, on, or off.
  --decode-trace Enable frontend viewer decode tracing in the desktop launch log.
  --decode-debug  Enable verbose native decode logging in the launch log.
  --help          Show this help message.

All other arguments are passed through to scripts/desktop-memory-capture.py.
EOF
}

free_space_mb() {
  df -m "${REPO_ROOT}" | awk 'NR==2 {print $4}'
}

ensure_launch_headroom() {
  local free_before free_after target_size
  free_before="$(free_space_mb)"

  if (( free_before >= DEFAULT_MIN_FREE_MB )); then
    echo "Free disk OK: ${free_before} MB available."
    return 0
  fi

  echo "Free disk is low: ${free_before} MB available, ${DEFAULT_MIN_FREE_MB} MB required before launch."

  if [[ -e "${REBUILDABLE_TARGET_PATH}" ]]; then
    target_size="$(du -sh "${REBUILDABLE_TARGET_PATH}" 2>/dev/null | awk '{print $1}')"
    target_size="${target_size:-unknown}"
    echo "Removing rebuildable ${REBUILDABLE_TARGET_PATH} (${target_size}) before launch..."
    rm -rf "${REBUILDABLE_TARGET_PATH}"
  fi

  free_after="$(free_space_mb)"
  echo "Free disk after cleanup: ${free_after} MB available."
  if (( free_after < DEFAULT_MIN_FREE_MB )); then
    echo "Still below the ${DEFAULT_MIN_FREE_MB} MB launch threshold. Free more disk space and try again." >&2
    exit 1
  fi
}

desktop_pid() {
  local pid=""

  pid="$(pgrep -x "${DESKTOP_PROCESS_NAME}" | head -n 1 || true)"
  if [[ -n "${pid}" ]]; then
    printf '%s\n' "${pid}"
    return 0
  fi

  pgrep -f "${DESKTOP_BINARY_PATTERN}" | head -n 1 || true
}

tail_launch_log() {
  if [[ -f "${LAUNCH_LOG_PATH}" ]]; then
    echo
    echo "Recent launch log:"
    tail -n 60 "${LAUNCH_LOG_PATH}" || true
  fi
}

cleanup() {
  local exit_code=$?

  if [[ -n "${LAUNCH_PID}" ]] && kill -0 "${LAUNCH_PID}" >/dev/null 2>&1; then
    kill "${LAUNCH_PID}" >/dev/null 2>&1 || true
    wait "${LAUNCH_PID}" 2>/dev/null || true
  fi

  exit "${exit_code}"
}

wait_for_desktop_process() {
  local elapsed=0
  local pid=""

  while (( elapsed < LAUNCH_TIMEOUT_SECONDS )); do
    pid="$(desktop_pid)"
    if [[ -n "${pid}" ]]; then
      printf '%s\n' "${pid}"
      return 0
    fi

    if [[ -n "${LAUNCH_PID}" ]] && ! kill -0 "${LAUNCH_PID}" >/dev/null 2>&1; then
      echo "Desktop launch exited before the Tauri process appeared." >&2
      tail_launch_log
      exit 1
    fi

    sleep 1
    elapsed=$((elapsed + 1))
  done

  echo "Timed out waiting ${LAUNCH_TIMEOUT_SECONDS}s for the desktop process." >&2
  tail_launch_log
  exit 1
}

trap cleanup EXIT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --open-report)
      OPEN_REPORT=1
      shift
      ;;
    --decode-mode)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --decode-mode (expected: auto, js, or native)." >&2
        exit 1
      fi
      case "$2" in
        auto|js|native)
          LAUNCH_ARGS+=("--decode-mode" "$2")
          shift 2
          ;;
        *)
          echo "Unsupported --decode-mode value: $2 (expected: auto, js, or native)." >&2
          exit 1
          ;;
      esac
      ;;
    --decode-debug)
      LAUNCH_ARGS+=("--decode-debug")
      shift
      ;;
    --decode-trace)
      LAUNCH_ARGS+=("--decode-trace")
      shift
      ;;
    --preload-mode)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --preload-mode (expected: auto, on, or off)." >&2
        exit 1
      fi
      case "$2" in
        auto|on|off)
          LAUNCH_ARGS+=("--preload-mode" "$2")
          shift 2
          ;;
        *)
          echo "Unsupported --preload-mode value: $2 (expected: auto, on, or off)." >&2
          exit 1
          ;;
      esac
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      CAPTURE_ARGS+=("$1")
      shift
      ;;
  esac
done

mkdir -p "${ARTIFACT_DIR}"

if [[ -n "$(desktop_pid)" ]]; then
  echo "A desktop app process is already running for this worktree. Close it before starting a new memory session." >&2
  exit 1
fi

ensure_launch_headroom

echo "Starting desktop app..."
echo "Launch log: ${LAUNCH_LOG_PATH}"
(
  cd "${REPO_ROOT}/desktop"
  launch_cmd=(npm run dev:desktop)
  if (( ${#LAUNCH_ARGS[@]} > 0 )); then
    launch_cmd+=(-- "${LAUNCH_ARGS[@]}")
  fi
  "${launch_cmd[@]}"
) >"${LAUNCH_LOG_PATH}" 2>&1 &
LAUNCH_PID="$!"

DESKTOP_PID="$(wait_for_desktop_process)"
echo "Desktop app detected: PID ${DESKTOP_PID}"
echo "Capture will stop automatically when you close the desktop app."

capture_cmd=(
  python3 "${REPO_ROOT}/scripts/desktop-memory-capture.py"
  --pid "${DESKTOP_PID}"
  --html "${DEFAULT_HTML_PATH}"
  --ensure-free-mb 0
)

if (( ${#CAPTURE_ARGS[@]} > 0 )); then
  capture_cmd+=("${CAPTURE_ARGS[@]}")
fi

"${capture_cmd[@]}"

if [[ -n "${LAUNCH_PID}" ]]; then
  wait "${LAUNCH_PID}" 2>/dev/null || true
  LAUNCH_PID=""
fi

if (( OPEN_REPORT == 1 )) && [[ -f "${DEFAULT_HTML_PATH}" ]] && command -v open >/dev/null 2>&1; then
  open "${DEFAULT_HTML_PATH}" >/dev/null 2>&1 || true
fi

echo
echo "Dashboard: ${DEFAULT_HTML_PATH}"
echo "Launch log: ${LAUNCH_LOG_PATH}"
