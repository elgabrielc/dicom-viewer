#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCS_DIR="$(cd "${DESKTOP_DIR}/../docs" && pwd)"
DEV_HOST="${DICOM_DESKTOP_DEV_HOST:-127.0.0.1}"
DEV_PORT="${DICOM_DESKTOP_DEV_PORT:-1420}"
DEV_URL="http://${DEV_HOST}:${DEV_PORT}/"
PROD_APP_SUPPORT_DIR="${HOME}/Library/Application Support/health.divergent.dicomviewer"
WEB_SERVER_PID=""

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 1
    fi
}

listener_pid_for_dev_port() {
    lsof -tiTCP:"${DEV_PORT}" -sTCP:LISTEN -n -P 2>/dev/null | head -n 1
}

dev_tauri_config() {
    local config
    if ! config="$(python3 - "$DESKTOP_DIR/src-tauri/tauri.conf.dev.json" "$DEV_URL" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    config = json.load(config_file)

config.setdefault("build", {})["devUrl"] = sys.argv[2].rstrip("/")
print(json.dumps(config, separators=(",", ":")))
PY
    )"; then
        echo "Failed to build TAURI_CONFIG overlay from src-tauri/tauri.conf.dev.json." >&2
        return 1
    fi
    printf '%s\n' "$config"
}

desktop_binary_running() {
    pgrep -f "${DESKTOP_DIR}/src-tauri/target[^/]*/debug/dicom-viewer-desktop" >/dev/null 2>&1
}

warn_about_shared_prod_state() {
    if [[ ! -d "$PROD_APP_SUPPORT_DIR" ]]; then
        return 0
    fi

    cat >&2 <<EOF
Note: existing production app data is present at:
  ${PROD_APP_SUPPORT_DIR}

Dev builds now use health.divergent.dicomviewer.dev instead. Treat the
production directory above as shared production state; back it up before
manual repair, and only clean up old dev experiments after identifying exactly
which files belong to that experiment.
EOF
}

listener_command() {
    local pid="$1"
    ps -p "$pid" -o command= 2>/dev/null || true
}

clear_stale_dev_server_if_needed() {
    local pid command
    pid="$(listener_pid_for_dev_port || true)"
    if [[ -z "$pid" ]]; then
        return 0
    fi

    command="$(listener_command "$pid")"

    if desktop_binary_running; then
        echo "Port ${DEV_PORT} is already in use while the desktop app is running." >&2
        echo "Reuse the existing session or stop it before starting a new one." >&2
        exit 1
    fi

    if [[ "$command" == *"python"* ]] && [[ "$command" == *"http.server ${DEV_PORT}"* ]] && (
        [[ "$command" == *"--directory ${DOCS_DIR}"* ]] || [[ "$command" == *"--directory ../docs"* ]]
    ); then
        echo "Clearing stale desktop dev web server on ${DEV_HOST}:${DEV_PORT}..."
        kill "$pid"
        wait_for_port_to_clear
        return 0
    fi

    echo "Port ${DEV_PORT} is already in use by another process:" >&2
    echo "  ${command}" >&2
    echo "Stop that process or set DICOM_DESKTOP_DEV_PORT to a different port." >&2
    exit 1
}

wait_for_port_to_clear() {
    local attempts=50
    while [[ $attempts -gt 0 ]]; do
        if [[ -z "$(listener_pid_for_dev_port || true)" ]]; then
            return 0
        fi
        sleep 0.1
        attempts=$((attempts - 1))
    done

    echo "Timed out waiting for port ${DEV_PORT} to clear." >&2
    exit 1
}

wait_for_dev_server() {
    local attempts=50
    while [[ $attempts -gt 0 ]]; do
        if curl --silent --fail --output /dev/null "${DEV_URL}"; then
            return 0
        fi
        sleep 0.1
        attempts=$((attempts - 1))
    done

    echo "Timed out waiting for desktop dev server at ${DEV_URL}." >&2
    exit 1
}

cleanup() {
    if [[ -n "$WEB_SERVER_PID" ]] && kill -0 "$WEB_SERVER_PID" >/dev/null 2>&1; then
        kill "$WEB_SERVER_PID" >/dev/null 2>&1 || true
        wait "$WEB_SERVER_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT INT TERM

require_command python3
require_command cargo
require_command curl
require_command lsof
require_command pgrep

clear_stale_dev_server_if_needed

TAURI_CONFIG_VALUE="$(dev_tauri_config)"
warn_about_shared_prod_state

cd "$DESKTOP_DIR"
python3 -m http.server "$DEV_PORT" --bind "$DEV_HOST" --directory "$DOCS_DIR" &
WEB_SERVER_PID="$!"

echo "Serving docs/ at ${DEV_URL}"
wait_for_dev_server

echo "Launching desktop app..."
CARGO_TARGET_DIR="${DESKTOP_DIR}/src-tauri/target-dev" \
TAURI_CONFIG="$TAURI_CONFIG_VALUE" \
    cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always -- "$@"
