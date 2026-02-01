#!/bin/bash
# update-sitemap.sh
# Regenerates the folder tree section of SITEMAP.md
#
# Usage: ./update-sitemap.sh
#
# Copyright (c) 2026 Divergent Health Technologies

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SITEMAP="$SCRIPT_DIR/SITEMAP.md"

# Generate tree for project root (depth 2, excluding common ignores)
generate_tree() {
    local path="$1"
    local depth="$2"
    local name="$3"

    cd "$path"
    tree -L "$depth" -d --noreport \
        -I 'node_modules|venv|__pycache__|.git|.DS_Store|*.pyc' \
        2>/dev/null || find . -maxdepth "$depth" -type d \
        -not -path '*/node_modules/*' \
        -not -path '*/venv/*' \
        -not -path '*/__pycache__/*' \
        -not -path '*/.git/*' \
        | sort | sed 's|^./||' | head -30
}

# Get current date
DATE=$(date +%Y-%m-%d)

# Create new sitemap
cat > "$SITEMAP" << 'HEADER'
# Project Sitemap

A map of the project structure to help navigate the codebase and documentation.

---

## Project Root
HEADER

echo "" >> "$SITEMAP"
echo '```' >> "$SITEMAP"
echo "claude 0/" >> "$SITEMAP"

# List top-level items with descriptions
cd "$PROJECT_ROOT"
for item in */; do
    item="${item%/}"
    case "$item" in
        docs)
            echo "├── docs/                          # Documentation and planning" >> "$SITEMAP"
            ;;
        dicom-viewer)
            echo "├── dicom-viewer/                  # Main DICOM viewer application" >> "$SITEMAP"
            ;;
        test-data-mri-1)
            echo "├── test-data-mri-1/               # Test DICOM data (MRI)" >> "$SITEMAP"
            ;;
        test-data-mri-2)
            echo "├── test-data-mri-2/               # Test DICOM data (MRI)" >> "$SITEMAP"
            ;;
        test-data-errors)
            echo "├── test-data-errors/              # Problem DICOM files for debugging" >> "$SITEMAP"
            ;;
        deep-research-2x)
            echo "├── deep-research-2x/              # Research tooling" >> "$SITEMAP"
            ;;
        *)
            echo "├── $item/" >> "$SITEMAP"
            ;;
    esac
done

# Add standalone files
for file in *; do
    if [[ -f "$file" && "$file" != .* ]]; then
        echo "└── $file" >> "$SITEMAP"
    fi
done

echo '```' >> "$SITEMAP"

# Planning section
cat >> "$SITEMAP" << 'PLANNING'

---

## Planning (`docs/planning/`)

Research, decisions, and reference materials for feature development.

| File | Description |
|------|-------------|
PLANNING

# List planning docs
cd "$PROJECT_ROOT/docs/planning"
for file in *.md; do
    case "$file" in
        SITEMAP.md)
            echo "| \`SITEMAP.md\` | This file - project structure map |" >> "$SITEMAP"
            ;;
        3d-volume-rendering.md)
            echo "| \`3d-volume-rendering.md\` | Research and decisions for 3D volume rendering |" >> "$SITEMAP"
            ;;
        RESEARCH-measurement-tool.md)
            echo "| \`RESEARCH-measurement-tool.md\` | Benchmarking of measurement tools (Horos, NilRead, Ambra) |" >> "$SITEMAP"
            ;;
        RESEARCH-*)
            # Generic handler for other research files
            name="${file%.md}"
            echo "| \`$file\` | ${name#RESEARCH-} research |" >> "$SITEMAP"
            ;;
        PLAN-*)
            name="${file%.md}"
            echo "| \`$file\` | ${name#PLAN-} implementation plan |" >> "$SITEMAP"
            ;;
        *)
            echo "| \`$file\` | |" >> "$SITEMAP"
            ;;
    esac
done

# DICOM viewer section
cat >> "$SITEMAP" << 'VIEWER'

---

## DICOM Viewer Application (`dicom-viewer/`)

```
dicom-viewer/
├── app.py                 # Flask backend
├── requirements.txt       # Python dependencies
├── docs/                  # Frontend static files
│   ├── index.html         # Main SPA
│   ├── css/               # Styles
│   ├── js/                # JavaScript + WASM
│   └── sample/            # Demo DICOM files
├── tests/                 # Playwright E2E tests
├── test-data/             # Test DICOM files
└── uploads/               # Server upload destination
```

| Entry Point | Command |
|-------------|---------|
| Dev server | `python app.py` (port 5001) |
| Tests | `npx playwright test` |

---

## Current Work in Progress

> **Edit this section manually to track active work.**

### Measurement Tool
- **Status**: Research complete, implementation pending
- **Doc**: `docs/planning/RESEARCH-measurement-tool.md`

### 3D Volume Rendering
- **Status**: Research complete, not started
- **Doc**: `docs/planning/3d-volume-rendering.md`

VIEWER

# Add timestamp
echo "" >> "$SITEMAP"
echo "---" >> "$SITEMAP"
echo "" >> "$SITEMAP"
echo "*Auto-generated: $DATE — Run \`./update-sitemap.sh\` to refresh*" >> "$SITEMAP"

echo "Updated $SITEMAP"
