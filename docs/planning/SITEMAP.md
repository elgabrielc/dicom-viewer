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
| `CODE_REVIEWS.md` | PR review findings and resolution tracking |
| `DEPLOY.md` | Deployment guide: local dev, GitHub Pages, CI/CD workflow |
| `DEVELOPMENT_PHILOSOPHY.md` | Learning guide: why branches, CI/CD, preview environments, code review exist |
| `TESTING.md` | Testing documentation and Playwright setup |

## Planning (`dicom-viewer/docs/planning/`)

Research, decisions, and reference materials for feature development.

| File | Description |
|------|-------------|
| `PLAN-tauri-desktop-app.md` | Historical implementation plan for the Tauri desktop shell, restored from the original Claude-authored planning doc and annotated with the commits/PRs that completed it |
| `PLAN-tauri-release.md` | Release plan for shipping the Tauri desktop app as a signed, notarized macOS artifact, with the plain DMG as the official packaging path and Finder-styled DMG work deferred |
| `PLAN-notes.md` | Notes feature (descriptions + comments): design decisions, storage rationale, future improvements, recommended tests |
| `RESEARCH-3d-volume-rendering.md` | 3D volume rendering research: architecture decisions, modularity, graceful degradation, testability considerations. Related: [CLAUDE.md Current Work](#current-work-in-progress) |
| `RESEARCH-measurement-tool.md` | Benchmarking of measurement tools (Horos, NilRead, Ambra, Sectra UniView): calibration, pixel spacing, interaction models, display formats, clinical warnings. Related: [Feature Inventory - Measurement tool](../index.html) |
| `RESEARCH-measurement-tool-prompt.md` | Research prompt used for Ambra measurement tool investigation |
| `RESEARCH-measurement-tool-thinking.md` | Research thinking process and synthesis for measurement tool implementation decisions |
| `SITEMAP.md` | This file - project structure map |

---

## Decisions (`dicom-viewer/docs/decisions/`)

Architecture Decision Records (ADRs) for significant project decisions and rationale.

| File | Description |
|------|-------------|
| `README.md` | ADR convention, template, and writing guidance |
| `001-launch-command.md` | Decision record for macOS `launch.command` startup workflow |
| `002-persistent-local-library.md` | Decision record for persistent DICOM library with DicomFolderSource, configurable folder, and apiBase pattern |
| `003-tauri-desktop-shell-with-shared-web-core.md` | Decision record for the shared web core plus Tauri desktop shell direction |

---

## DICOM Viewer Application (`dicom-viewer/`)

```
dicom-viewer/
├── .github/workflows/     # CI/CD configuration
│   └── pr-validate.yml    # PR validation (runs tests)
├── app.py                 # Flask backend
├── desktop/               # Tauri desktop shell, Rust entry point, icons, build config
├── requirements.txt       # Python dependencies
├── CLAUDE.md              # Claude Code context and instructions
├── CONTRIBUTING.md        # Contribution guidelines
├── docs/                  # Frontend static files + documentation
│   ├── index.html         # Main SPA
│   ├── css/               # Styles
│   ├── js/                # JavaScript, config.js, WASM decoders
│   ├── sample/            # Demo CT scan
│   ├── sample-mri/        # Demo MRI scan
│   ├── planning/          # Research and feature planning
│   ├── decisions/         # ADRs and architecture rationale
│   ├── BUGS.md            # Bug tracking
│   ├── DEPLOY.md          # Deployment guide
│   ├── DEVELOPMENT_PHILOSOPHY.md  # Why we work this way
│   └── TESTING.md         # Test documentation
├── tests/                 # Playwright E2E tests, including mocked desktop integration checks
├── test-fixtures/         # Minimal DICOM data for CI
└── uploads/               # Server upload destination
```

| Entry Point | Command |
|-------------|---------|
| Dev server | `python app.py` (port 5001) |
| Tests | `npx playwright test` |

---

## Current Work in Progress

> **Edit this section manually to track active work.**

| Feature | Status | Planning | Implementation |
|---------|--------|----------|----------------|
| Notes | Implemented (with localStorage) | [PLAN-notes.md](PLAN-notes.md) | [Feature Inventory](../../CLAUDE.md#feature-inventory) |
| Measurement Tool | Implemented (2026-02-01) | [RESEARCH-measurement-tool.md](RESEARCH-measurement-tool.md) | [Feature Inventory](../../CLAUDE.md#feature-inventory) |
| 3D Volume Rendering | Research complete, not started | [RESEARCH-3d-volume-rendering.md](RESEARCH-3d-volume-rendering.md) | [Current Work](../../CLAUDE.md#current-work-3d-volume-rendering) |


---

*Last updated: 2026-03-09*
