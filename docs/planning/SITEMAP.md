# Project Sitemap

A map of the project structure to help navigate the codebase and documentation.

---

## Workspace Structure

```
claude 0/                          # Workspace/inbox - drop files here for Claude
├── dicom-viewer/                  # Git repo - organized, version-controlled project
├── test-data-mri-1/               # Test DICOM data (used by Flask test mode)
├── test-data-mri-2/               # Additional test data
└── test-data-errors/              # Problem DICOM files for debugging
```

- **`claude 0/`** is a workspace where the user drops files for Claude to process
- **`dicom-viewer/`** is the organized project; files get moved here as appropriate
- Planning docs, bug tracking, and research live in `dicom-viewer/docs/planning/`

---

## Documentation (`dicom-viewer/docs/`)

| File | Description |
|------|-------------|
| `BUGS.md` | Bug tracking and known issues |
| `TESTING.md` | Testing documentation and Playwright setup |

## Planning (`dicom-viewer/docs/planning/`)

Research, decisions, and reference materials for feature development.

| File | Description |
|------|-------------|
| `RESEARCH-3d-volume-rendering.md` | 3D volume rendering research: architecture decisions, modularity, graceful degradation, testability considerations. Related: [CLAUDE.md Current Work](#current-work-in-progress) |
| `RESEARCH-measurement-tool.md` | Benchmarking of measurement tools (Horos, NilRead, Ambra, Sectra UniView): calibration, pixel spacing, interaction models, display formats, clinical warnings. Related: [Feature Inventory - Measurement tool](../index.html) |
| `RESEARCH-measurement-tool-prompt.md` | Research prompt used for Ambra measurement tool investigation |
| `RESEARCH-measurement-tool-thinking.md` | Research thinking process and synthesis for measurement tool implementation decisions |
| `SITEMAP.md` | This file - project structure map |

---

## DICOM Viewer Application (`dicom-viewer/`)

```
dicom-viewer/
├── app.py                 # Flask backend
├── requirements.txt       # Python dependencies
├── CLAUDE.md              # Claude Code context and instructions
├── docs/                  # Frontend static files + documentation
│   ├── index.html         # Main SPA
│   ├── css/               # Styles
│   ├── js/                # JavaScript + WASM
│   ├── sample/            # Demo CT scan
│   ├── sample-mri/        # Demo MRI scan
│   ├── planning/          # Research and feature planning
│   ├── BUGS.md            # Bug tracking
│   └── TESTING.md         # Test documentation
├── tests/                 # Playwright E2E tests
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
- **Research**: [RESEARCH-measurement-tool.md](RESEARCH-measurement-tool.md) - Benchmarking of Horos, NilRead, Ambra, Sectra UniView
- **Implementation**: [CLAUDE.md Feature Inventory](../../CLAUDE.md#feature-inventory) - Click-drag distance measurement with PixelSpacing calibration

### 3D Volume Rendering
- **Status**: Research complete, not started
- **Research**: [RESEARCH-3d-volume-rendering.md](RESEARCH-3d-volume-rendering.md) - Architecture, modularity, testability
- **Implementation**: [CLAUDE.md Current Work](../../CLAUDE.md#current-work-3d-volume-rendering) - vtk.js decision and next steps


---

*Last updated: 2026-02-01*
