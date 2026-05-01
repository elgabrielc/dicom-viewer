#!/usr/bin/env bash
# Copyright (c) 2026 Divergent Health Technologies
#
# Release script for the myradone desktop app.
# Bumps version across all desktop files, commits, and optionally tags + pushes.
#
# Usage:
#   ./desktop/scripts/release.sh <major|minor|patch|x.y.z[-prerelease]> [--push]
#
# Examples:
#   ./desktop/scripts/release.sh patch          # 0.1.0 -> 0.1.1 (prepare only)
#   ./desktop/scripts/release.sh minor --push   # 0.1.0 -> 0.2.0 (prepare + tag + push)
#   ./desktop/scripts/release.sh 0.2.0-rc.1     # explicit prerelease

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/.." && pwd)"

# Files that contain the desktop version
TAURI_CONF="$DESKTOP_DIR/src-tauri/tauri.conf.json"
CARGO_TOML="$DESKTOP_DIR/src-tauri/Cargo.toml"
PKG_JSON="$DESKTOP_DIR/package.json"
PKG_LOCK="$DESKTOP_DIR/package-lock.json"

# --- Helpers ---

die() { echo "Error: $1" >&2; exit 1; }

read_tauri_version() {
    node -p "require('$TAURI_CONF').version"
}

read_cargo_version() {
    grep '^version = ' "$CARGO_TOML" | head -1 | sed 's/version = "\(.*\)"/\1/'
}

read_pkg_version() {
    node -p "require('$PKG_JSON').version"
}

read_pkg_lock_version() {
    node -p "require('$PKG_LOCK').version"
}

# --- Phase 1: Validate ---

# Parse arguments
PUSH=0
VERSION_ARG=""
for arg in "$@"; do
    case "$arg" in
        --push) PUSH=1 ;;
        -h|--help)
            echo "Usage: $0 <major|minor|patch|x.y.z[-prerelease]> [--push]"
            exit 0
            ;;
        *) VERSION_ARG="$arg" ;;
    esac
done

if [ -z "$VERSION_ARG" ]; then
    echo "Usage: $0 <major|minor|patch|x.y.z[-prerelease]> [--push]"
    echo ""
    echo "Examples:"
    echo "  $0 patch              # 0.1.0 -> 0.1.1"
    echo "  $0 minor              # 0.1.0 -> 0.2.0"
    echo "  $0 major              # 0.1.0 -> 1.0.0"
    echo "  $0 0.2.0-rc.1         # explicit version"
    echo "  $0 patch --push       # prepare + tag + push"
    exit 1
fi

# Read current version from source of truth
CURRENT=$(read_tauri_version)
echo "Current version: $CURRENT"

# Assert all 4 files match
CARGO_V=$(read_cargo_version)
PKG_V=$(read_pkg_version)
LOCK_V=$(read_pkg_lock_version)

if [ "$CURRENT" != "$CARGO_V" ]; then
    die "Version mismatch: tauri.conf.json=$CURRENT but Cargo.toml=$CARGO_V"
fi
if [ "$CURRENT" != "$PKG_V" ]; then
    die "Version mismatch: tauri.conf.json=$CURRENT but package.json=$PKG_V"
fi
if [ "$CURRENT" != "$LOCK_V" ]; then
    die "Version mismatch: tauri.conf.json=$CURRENT but package-lock.json=$LOCK_V"
fi

# Assert no modified or staged files (untracked files are OK)
if [ -n "$(git -C "$REPO_ROOT" diff --name-only HEAD)" ] || [ -n "$(git -C "$REPO_ROOT" diff --cached --name-only)" ]; then
    die "Working tree has modified or staged files. Commit or stash changes first."
fi

# Assert HEAD matches origin/main
git -C "$REPO_ROOT" fetch origin main --quiet
LOCAL_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
REMOTE_SHA=$(git -C "$REPO_ROOT" rev-parse origin/main)
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    die "HEAD ($LOCAL_SHA) does not match origin/main ($REMOTE_SHA). Pull or rebase first."
fi

# --- Calculate new version ---

IFS='.' read -r MAJOR MINOR PATCH <<< "$(echo "$CURRENT" | sed 's/-.*//')"

case "$VERSION_ARG" in
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    *)
        # Validate explicit version format (semver with optional prerelease)
        if ! echo "$VERSION_ARG" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
            die "Invalid version: $VERSION_ARG (expected x.y.z or x.y.z-prerelease)"
        fi
        NEW_VERSION="$VERSION_ARG"
        ;;
esac

# Assert tag doesn't exist
TAG="v$NEW_VERSION"
if git -C "$REPO_ROOT" tag -l "$TAG" | grep -q "$TAG"; then
    die "Tag $TAG already exists."
fi

echo "New version: $NEW_VERSION"
echo "Tag: $TAG"
echo ""

# --- Phase 2: Prepare ---

echo "Updating version files..."

# tauri.conf.json
node -e "
const fs = require('fs');
const conf = JSON.parse(fs.readFileSync('$TAURI_CONF', 'utf8'));
conf.version = '$NEW_VERSION';
fs.writeFileSync('$TAURI_CONF', JSON.stringify(conf, null, 2) + '\n');
"

# Cargo.toml (replace first version = line only)
sed -i '' "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" "$CARGO_TOML"

# package.json + package-lock.json
cd "$DESKTOP_DIR"
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version > /dev/null 2>&1

# Cargo.lock
echo "Updating Cargo.lock..."
cd "$DESKTOP_DIR/src-tauri"
cargo check --quiet 2>/dev/null

cd "$REPO_ROOT"

# Show diff
echo ""
echo "--- Changes ---"
git diff --stat
echo ""
git diff -- desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/package.json
echo ""

# Confirm
read -p "Commit Release $TAG? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted. Reverting changes..."
    git checkout -- .
    exit 0
fi

# Commit
git add \
    desktop/src-tauri/tauri.conf.json \
    desktop/src-tauri/Cargo.toml \
    desktop/src-tauri/Cargo.lock \
    desktop/package.json \
    desktop/package-lock.json

git commit -m "Release $TAG"

echo ""
echo "Committed: Release $TAG"

# --- Phase 3: Push (optional) ---

if [ "$PUSH" -eq 1 ]; then
    echo ""
    read -p "Tag and push $TAG to origin? This triggers the release build. (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Commit created but not tagged or pushed."
        echo "To finish: git tag $TAG && git push origin main --tags"
        exit 0
    fi

    git tag "$TAG"
    # Push commit first, then tag separately. GitHub doesn't always
    # trigger tag-based workflows when both arrive in a single push.
    git push origin main
    git push origin "$TAG"

    echo ""
    echo "Tag $TAG pushed. CI is building."
    echo "Check https://github.com/elgabrielc/dicom-viewer/releases in ~20 minutes."
else
    echo ""
    echo "Release prepared but not pushed."
    echo "To finish:"
    echo "  git tag $TAG && git push origin main && git push origin $TAG"
fi
