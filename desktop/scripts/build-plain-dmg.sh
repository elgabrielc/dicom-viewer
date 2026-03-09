#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Plain DMG packaging is only supported on macOS." >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
    cat <<'EOF'
Build a plain macOS DMG for the Tauri desktop app.

This path intentionally skips Finder AppleScript styling so it can run
reliably in automation and other non-interactive environments.

Usage:
  ./scripts/build-plain-dmg.sh [--output /path/to/output.dmg]
EOF
}

OUTPUT_PATH=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output)
            OUTPUT_PATH="${2:-}"
            if [[ -z "$OUTPUT_PATH" ]]; then
                echo "--output requires a path." >&2
                exit 1
            fi
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

cd "$DESKTOP_DIR"

PRODUCT_NAME="$(node -p "require('./src-tauri/tauri.conf.json').productName")"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
ARCH="$(uname -m)"
APP_BUNDLE="src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app"
DMG_DIR="src-tauri/target/release/bundle/dmg"
DEFAULT_OUTPUT="${DMG_DIR}/${PRODUCT_NAME}_${VERSION}_${ARCH}_plain.dmg"

if [[ -z "$OUTPUT_PATH" ]]; then
    OUTPUT_PATH="$DEFAULT_OUTPUT"
fi

mkdir -p "$DMG_DIR" "$(dirname "$OUTPUT_PATH")"

echo "Building ${PRODUCT_NAME}.app..."
npm run tauri build -- --bundles app

if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "Expected app bundle was not produced: $APP_BUNDLE" >&2
    exit 1
fi

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dicom-viewer-plain-dmg.XXXXXX")"
cleanup() {
    rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

# Avoid copying Finder metadata from previous manual DMG experiments.
rm -f "src-tauri/target/release/bundle/macos/.DS_Store"

echo "Preparing plain DMG staging directory..."
ditto "$APP_BUNDLE" "${STAGING_DIR}/$(basename "$APP_BUNDLE")"
ln -s /Applications "${STAGING_DIR}/Applications"

echo "Packaging plain DMG at ${OUTPUT_PATH}..."
rm -f "$OUTPUT_PATH"
hdiutil create \
    -volname "$PRODUCT_NAME" \
    -srcfolder "$STAGING_DIR" \
    -fs HFS+ \
    -format UDZO \
    -imagekey zlib-level=9 \
    -ov \
    "$OUTPUT_PATH"

echo "Plain DMG created: $OUTPUT_PATH"
