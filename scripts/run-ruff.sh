#!/usr/bin/env bash

set -euo pipefail

RUFF_VERSION="${RUFF_VERSION:-0.15.9}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
VENV_DIR="$CACHE_HOME/dicom-viewer/ruff-$RUFF_VERSION"

if [[ ! -x "$VENV_DIR/bin/ruff" ]]; then
  mkdir -p "$(dirname "$VENV_DIR")"
  python3 -m venv "$VENV_DIR"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  pip install --quiet --disable-pip-version-check "ruff==$RUFF_VERSION"
else
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
fi

exec "$VENV_DIR/bin/ruff" "$@"
