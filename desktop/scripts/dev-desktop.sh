#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCS_DIR="$(cd "${DESKTOP_DIR}/../docs" && pwd)"
DEV_HOST="${DICOM_DESKTOP_DEV_HOST:-127.0.0.1}"
DEV_PORT="${DICOM_DESKTOP_DEV_PORT:-1420}"
DEV_URL="http://${DEV_HOST}:${DEV_PORT}/"
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

desktop_binary_running() {
    pgrep -f "${DESKTOP_DIR}/src-tauri/target/debug/dicom-viewer-desktop" >/dev/null 2>&1
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

cd "$DESKTOP_DIR"
python3 -m http.server "$DEV_PORT" --bind "$DEV_HOST" --directory "$DOCS_DIR" &
WEB_SERVER_PID="$!"

echo "Serving docs/ at ${DEV_URL}"
wait_for_dev_server

echo "Launching desktop app..."
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --color always -- "$@"
