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
LAUNCH_COMMAND="${DICOM_MEMORY_LAUNCH_COMMAND:-npm run desktop:launch}"
REBUILDABLE_TARGET_PATH="${REPO_ROOT}/desktop/src-tauri/target"

LAUNCH_PID=""
OPEN_REPORT=0
CAPTURE_ARGS=()

usage() {
  cat <<EOF
Usage: npm run desktop:memory:session -- [capture options]

Launch the desktop app, wait for the Tauri process, and start RSS capture automatically.

Examples:
  npm run desktop:memory:session
  npm run desktop:memory:session -- --notes "rapid scrub run"
  npm run desktop:memory:session -- --open-report

Wrapper options:
  --open-report   Open the generated HTML dashboard when the run finishes.
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
  cd "${REPO_ROOT}"
  /bin/zsh -lc "${LAUNCH_COMMAND}"
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
