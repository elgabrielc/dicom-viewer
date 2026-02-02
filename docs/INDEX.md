<!--
  INDEX.md - Master Documentation Index
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# DICOM Viewer Documentation Index

Master index of all project documentation, organized by audience and purpose.

---

## Quick Links by Audience

### For Users

| Document | Location | Description |
|----------|----------|-------------|
| [User Guide](../USER_GUIDE.md) | Root | Comprehensive guide for end users: loading images, navigation, tools, keyboard shortcuts, troubleshooting |
| [README - Quick Start](../README.md#quick-start) | Root | Getting started in under 5 minutes |

### For Developers

| Document | Location | Description |
|----------|----------|-------------|
| [CLAUDE.md](../CLAUDE.md) | Root | Project context, architecture, technical decisions, feature inventory, and development guidelines |
| [API Reference](./API.md) | docs/ | REST API endpoints for test mode (Flask backend) |
| [Configuration](./CONFIG.md) | docs/ | Environment variables, runtime settings, browser requirements |
| [Testing Guide](./TESTING.md) | docs/ | Playwright test setup, helper functions, writing tests, visual verification |
| [Deployment Guide](./DEPLOY.md) | docs/ | Local development, GitHub Pages, custom domains, troubleshooting |
| [Contributing](../CONTRIBUTING.md) | Root | Code style, git workflow, pull request process, issue templates |
| [Bug Tracking](./BUGS.md) | docs/ | Known issues, resolved bugs with root cause analysis, bug template |
| [Changelog](../CHANGELOG.md) | Root | Version history and release notes |

### For Planning

| Document | Location | Description |
|----------|----------|-------------|
| [3D Volume Rendering Plan](../3D_VOLUME_RENDERING_PLAN.md) | Root | Implementation plan for 3D features: vtk.js, volume rendering, MIP |
| [Project Sitemap](./planning/SITEMAP.md) | docs/planning/ | File structure map and active work tracking |
| [3D Research](./planning/RESEARCH-3d-volume-rendering.md) | docs/planning/ | Benchmarking study of 3D rendering approaches |
| [Measurement Tool Research](./planning/RESEARCH-measurement-tool.md) | docs/planning/ | Benchmarking of measurement tools (Horos, Ambra, Sectra) |

---

## Document Locations

Documentation is organized across three locations:

### Root Directory (`/`)

Core project documentation visible in the repository root.

```
dicom-viewer/
├── README.md              # Project overview and quick start
├── CLAUDE.md              # Technical context for Claude Code
├── USER_GUIDE.md          # End-user documentation
├── CONTRIBUTING.md        # Contribution guidelines
├── CHANGELOG.md           # Version history
└── 3D_VOLUME_RENDERING_PLAN.md  # 3D feature roadmap
```

### docs/ Directory

Technical documentation for developers and operations.

```
docs/
├── INDEX.md               # This file - master documentation index
├── API.md                 # REST API reference
├── CONFIG.md              # Configuration reference
├── DEPLOY.md              # Deployment guide
├── TESTING.md             # Testing documentation
├── BUGS.md                # Bug tracking
└── planning/              # Planning and research documents
```

### docs/planning/ Directory

Research, decision logs, and feature planning.

```
docs/planning/
├── SITEMAP.md                              # Project structure map
├── RESEARCH-3d-volume-rendering.md         # 3D rendering research
├── RESEARCH-measurement-tool.md            # Measurement tool benchmarking
├── RESEARCH-measurement-tool-prompt.md     # Research methodology
└── RESEARCH-measurement-tool-thinking.md   # Research analysis
```

---

## Recommended Reading Order

### For New Contributors

Start here to understand the project before contributing:

1. **[README.md](../README.md)** - Project overview, features, architecture diagram
2. **[CLAUDE.md](../CLAUDE.md)** - Technical context, conventions, feature inventory (critical: read before making changes)
3. **[CONTRIBUTING.md](../CONTRIBUTING.md)** - Code style, git workflow, PR process
4. **[TESTING.md](./TESTING.md)** - How to run tests, write new tests
5. **[Sitemap](./planning/SITEMAP.md)** - Navigate the codebase

### For Deployment

1. **[DEPLOY.md](./DEPLOY.md)** - All deployment options and troubleshooting
2. **[CONFIG.md](./CONFIG.md)** - Environment variables and settings

### For Feature Development

1. **[CLAUDE.md](../CLAUDE.md)** - Architecture and existing features
2. **[API.md](./API.md)** - Backend endpoints (if modifying server)
3. **[TESTING.md](./TESTING.md)** - Test requirements for new features
4. **Relevant RESEARCH-*.md** - Prior art and design decisions

### For Understanding 3D Plans

1. **[3D_VOLUME_RENDERING_PLAN.md](../3D_VOLUME_RENDERING_PLAN.md)** - High-level plan and technology decisions
2. **[RESEARCH-3d-volume-rendering.md](./planning/RESEARCH-3d-volume-rendering.md)** - Detailed research and benchmarking

---

## Document Descriptions

### Core Documentation

**README.md**
Project entry point. Contains feature list, architecture diagram, quick start instructions, browser compatibility, and project structure overview. This is what users see first on GitHub.

**CLAUDE.md**
Technical context document for Claude Code sessions. Contains architecture details, DICOM tag reference, window/level defaults, feature inventory, documentation requirements, and git workflow controls. Must be read before making code changes.

**USER_GUIDE.md**
Comprehensive user documentation. Explains DICOM concepts, how to load images, use viewing tools (W/L, pan, zoom), navigate slices, and troubleshoot common issues. Written for non-technical users.

**CONTRIBUTING.md**
Contribution guidelines. Covers development setup, code style (JavaScript, Python, CSS), git branch naming, commit message format, PR process, and code of conduct.

**CHANGELOG.md**
Version history following semantic versioning. Documents new features, bug fixes, and breaking changes for each release.

**3D_VOLUME_RENDERING_PLAN.md**
Implementation roadmap for 3D volume rendering. Includes guiding principles, technology selection (vtk.js), phased feature list, UI design, and performance considerations.

### Technical Documentation

**API.md**
REST API reference for the Flask test mode endpoints. Documents `/api/test-data/info`, `/api/test-data/studies`, and `/api/test-data/dicom/` endpoints with request/response examples.

**CONFIG.md**
Configuration reference. Covers `DICOM_TEST_DATA` environment variable, Flask settings, Playwright configuration, browser requirements, and test mode URL parameters.

**DEPLOY.md**
Deployment guide for local development (Flask, static server) and production (GitHub Pages). Includes custom domain setup, environment differences, and troubleshooting.

**TESTING.md**
Comprehensive testing documentation. Covers Playwright setup, test mode architecture, helper functions (with detailed explanations of `waitForViewerReady`, `getCanvasTransform`, `performDrag`), blank slice handling, visual verification with 9-region sampling, and test limitations.

**BUGS.md**
Bug tracking with full context. Each bug includes how it was encountered, root cause analysis, solution, why that solution was chosen, and prevention controls. Uses a standard template for consistency.

### Planning Documentation

**SITEMAP.md**
Project structure map showing workspace layout, file organization, and current work in progress. Keep updated when adding or moving files.

**RESEARCH-*.md**
Research documents capturing benchmarking and analysis before feature implementation. Includes competitive analysis, technology comparisons, and design rationale.

---

## Keeping Documentation Updated

### When to Update Each Document

| Document | Update When |
|----------|-------------|
| README.md | Adding/removing features, changing quick start steps |
| CLAUDE.md | Architecture changes, new conventions, feature additions |
| USER_GUIDE.md | UI changes, new user-facing features |
| CONTRIBUTING.md | Process changes, new conventions |
| CHANGELOG.md | Every release |
| API.md | API endpoint changes |
| CONFIG.md | New configuration options |
| DEPLOY.md | Deployment process changes |
| TESTING.md | New test patterns, helper functions |
| BUGS.md | Bug discovery and resolution |
| SITEMAP.md | File structure changes |
| INDEX.md | New documentation files |

### Documentation Requirements (from CLAUDE.md)

- Keep SITEMAP.md accurate when project structure changes
- Track bugs in BUGS.md with full context (symptoms, root cause, solution, prevention)
- Document "why" not just "what" - future developers need context

---

*Last updated: 2026-02-01*
