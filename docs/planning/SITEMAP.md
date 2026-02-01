# Project Sitemap

A map of the project structure to help navigate the codebase and documentation.

---

## Project Root

```
claude 0/
├── deep-research-2x/              # Research tooling
├── dicom-viewer/                  # Main DICOM viewer application
├── docs/                          # Documentation and planning
├── test-data-errors/              # Problem DICOM files for debugging
├── test-data-mri-1/               # Test DICOM data (MRI)
├── test-data-mri-2/               # Test DICOM data (MRI)
```

---

## Planning (`docs/planning/`)

Research, decisions, and reference materials for feature development.

| File | Description |
|------|-------------|
| `BUGS.md` | Bug tracking and known issues |
| `RESEARCH-3d-volume-rendering.md` | 3d-volume-rendering research |
| `RESEARCH-measurement-tool-prompt.md` | measurement-tool-prompt research |
| `RESEARCH-measurement-tool-thinking.md` | measurement-tool-thinking research |
| `RESEARCH-measurement-tool.md` | Benchmarking of measurement tools (Horos, NilRead, Ambra) |
| `SITEMAP.md` | This file - project structure map |

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
- **Status**: Implemented (2026-02-01, commit b75f15e)
- **Doc**: `docs/planning/RESEARCH-measurement-tool.md`

### 3D Volume Rendering
- **Status**: Research complete, not started
- **Doc**: `docs/planning/3d-volume-rendering.md`


---

*Auto-generated: 2026-01-31 — Run `./update-sitemap.sh` to refresh*
