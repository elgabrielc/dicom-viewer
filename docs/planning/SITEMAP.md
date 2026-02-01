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

## Planning (`dicom-viewer/docs/planning/`)

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
├── CLAUDE.md              # Claude Code context and instructions
├── docs/                  # Frontend static files + documentation
│   ├── index.html         # Main SPA
│   ├── css/               # Styles
│   ├── js/                # JavaScript + WASM
│   ├── sample/            # Demo CT scan
│   ├── sample-mri/        # Demo MRI scan
│   ├── planning/          # Planning docs, research, bug tracking
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
- **Doc**: `docs/planning/RESEARCH-measurement-tool.md`

### 3D Volume Rendering
- **Status**: Research complete, not started
- **Doc**: `docs/planning/3d-volume-rendering.md`


---

*Last updated: 2026-02-01*
