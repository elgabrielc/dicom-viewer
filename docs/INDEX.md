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
| [Agent Roles](../AGENTS.md) | Root | Agent workflow instructions and mandatory parallel-work rules for any coding agent |
| [API Reference](./API.md) | docs/ | REST API endpoints for test mode (Flask backend) |
| [Configuration](./CONFIG.md) | docs/ | Environment variables, runtime settings, browser requirements |
| [Testing Guide](./TESTING.md) | docs/ | Playwright test setup, helper functions, writing tests, visual verification |
| [Viewing Tools Test Plan](../TEST_PLAN_VIEWING_TOOLS.md) | Root | Comprehensive test plan for Window/Level, Pan, Zoom, and Reset functionality |
| [Parallel Agent Workflow](./AGENT_WORKTREES.md) | docs/ | Rules and helper commands for running multiple Codex and Claude sessions safely in parallel |
| [Parallel Agent Explainer](./AGENT_WORKTREES_EXPLAINER.md) | docs/ | Beginner walkthrough of the multi-agent cleanup, the branch/worktree model, and why the current workflow exists |
| [Agent Launchers](./AGENT_LAUNCHERS.md) | docs/ | Session launcher scripts for creating worktrees and starting AI sessions safely |
| [Parallel Execution Process](./PARALLEL_EXECUTION.md) | docs/ | Process for planning, staging, and executing large features using parallel AI agents |
| [Research Documentation Policy](./RESEARCH_POLICY.md) | docs/ | Policy for what benchmark and planning research belongs in git, what should stay local, and when research docs should be PRs |
| [Deployment Guide](./DEPLOY.md) | docs/ | Local development, GitHub Pages, custom domains, troubleshooting |
| [Contributing](../CONTRIBUTING.md) | Root | Code style, git workflow, pull request process, issue templates |
| [Bug Tracking](./BUGS.md) | docs/ | Known issues, resolved bugs with root cause analysis, bug template |
| [Code Reviews](./CODE_REVIEWS.md) | docs/ | PR review findings, severity grouping, and resolution status |
| [Desktop Library Diagnostics](./desktop-library-diagnostics.md) | docs/ | Quick reference for rerunning desktop library scan diagnostics |
| [Changelog](../CHANGELOG.md) | Root | Version history and release notes |
| [Benchmarking Research](../BENCHMARKING_RESEARCH.md) | Root | 3D volume rendering competitive benchmarking across established companies |

### For Planning

| Document | Location | Description |
|----------|----------|-------------|
| [Plans Index](./planning/PLANS.md) | docs/planning/ | Chronological index of all implementation plans with human-readable titles |
| [Project Sitemap](./planning/SITEMAP.md) | docs/planning/ | File structure map and active work tracking |
| [Remediation Plan](./planning/REMEDIATION-PLAN.md) | docs/planning/ | Prioritized remediation for security and debugging audit findings |
| [Tauri Release Plan](./planning/PLAN-tauri-release.md) | docs/planning/ | Release plan for the signed/notarized macOS desktop artifact |
| [3D Volume Rendering Plan](../3D_VOLUME_RENDERING_PLAN.md) | Root | Implementation plan for 3D features: vtk.js, volume rendering, MIP |
| [Tauri Desktop Plan](./planning/PLAN-tauri-desktop-app.md) | docs/planning/ | Historical plan for the Tauri desktop shell with PR mapping |
| [Sync Contract v1](./planning/SYNC-CONTRACT-V1.md) | docs/planning/ | Frozen wire protocol and auth model for cloud sync v1 |

### For Research

Feature design research (how to build things) and competitive intelligence (how others built things). Full index with companion files in [SITEMAP.md](./planning/SITEMAP.md).

| Document | Type | Description |
|----------|------|-------------|
| [3D Volume Rendering](./planning/RESEARCH-3d-volume-rendering.md) | Feature | Benchmarked Onshape, Fusion 360, 3D Slicer, Horos/OsiriX |
| [Measurement Tool](./planning/RESEARCH-measurement-tool.md) | Feature | Benchmarked Horos, NilRead, Ambra, Sectra UniView |
| [Ambra Reports](./planning/RESEARCH-ambra-reports_2026-02-02.md) | Feature | Ambra Health document/report handling |
| [OHIF Reports](./planning/RESEARCH-ohif-reports_2026-02-02.md) | Feature | OHIF Viewer DICOM-wrapped document handling |
| [MyChart Reports](./planning/RESEARCH-mychart-reports_2026-02-02_2148.md) | Feature | Epic MyChart document upload and storage |
| [Philips IM15](./planning/RESEARCH-philips-im15.md) | Competitive | Server-side rendering, AWS cloud, AI integration, market positioning |
| [Sectra](./planning/RESEARCH-sectra.md) | Competitive | Hybrid rendering, RapidConnect streaming, DDP hanging protocols, Azure cloud. KLAS #1 |
| [Visage 7 / Pro Medicus](./planning/RESEARCH-visage.md) | Competitive | Pure SSR from GPU servers, patented adaptive streaming, per-study pricing, 100% retention |
| [OHIF Viewer](./planning/RESEARCH-ohif.md) | Both | Open-source, Cornerstone3D/vtk.js, extension architecture, DICOMweb, HTJ2K progressive loading |
| [AWS HealthLake Imaging](./planning/RESEARCH-aws-healthlake-imaging.md) | Infrastructure | HTJ2K encoding, DICOMweb + OIDC, progressive loading via TLM Proxy, cloud storage for ADR 004 |
| [EasyRadiology](./planning/RESEARCH-easyradiology.md) | Competitive | easyRadiology AG architecture, market positioning, 35% German market share |
| [Word + OneDrive Sync](./planning/RESEARCH-word-onedrive-sync-prompt_2026-03-25_1124.md) | Infrastructure | Microsoft Word and OneDrive sync architecture, conflict resolution, informing cloud sync design |
| [Instrumentation: Todoist/Bitmapist](./planning/RESEARCH-instrumentation.md) | Instrumentation | Todoist analytics benchmarking, Bitmapist, Karma system, consent-first model |
| [Instrumentation: Sublime Text](./planning/RESEARCH-sublime-instrumentation-prompt_2026-04-06_1333.md) | Instrumentation | Sublime Text near-zero telemetry benchmarking, Panic privacy policy as template |
| [Instrumentation: Claude/Anthropic](./planning/RESEARCH-claude-instrumentation-prompt_2026-04-06_1345.md) | Instrumentation | Claude two-stream architecture, HIPAA BAA, enterprise compliance deep dive |
| [Instrumentation: Spotify/Wrapped](./planning/RESEARCH-spotify-instrumentation-prompt_2026-04-06_1358.md) | Instrumentation | Spotify data-as-feature, Wrapped viral model, event taxonomy at scale |
| [DICOM Sharing Compliance](./planning/RESEARCH-dicom-sharing-compliance-prompt_2026-04-06_1425.md) | Compliance | HIPAA/FTC classification, DICOMweb standards, Epic/Ambra integration paths |
| [Healthcare Compliance Costs](./planning/RESEARCH-healthcare-compliance-costs-prompt_2026-04-06_1445.md) | Compliance | Itemized SOC 2/HITRUST/Epic/Ambra costs, three scenarios, startup examples |

### For Decisions

| Document | Location | Description |
|----------|----------|-------------|
| [ADR Guide](./decisions/README.md) | docs/decisions/ | ADR conventions, template, and writing criteria |
| [ADR 001: launch.command](./decisions/001-launch-command.md) | docs/decisions/ | Decision record for macOS double-click startup workflow |
| [ADR 002: Persistent Local Library](./decisions/002-persistent-local-library.md) | docs/decisions/ | Decision record for persistent DICOM library with DicomFolderSource architecture |
| [ADR 003: Tauri Desktop Shell](./decisions/003-tauri-desktop-shell-with-shared-web-core.md) | docs/decisions/ | Decision record for the shared web core plus Tauri desktop shell direction |
| [ADR 004: Cloud Platform Rendering Architecture](./decisions/004-cloud-platform-rendering-architecture.md) | docs/decisions/ | Decision record for client-side vs server-side rendering in the future authenticated cloud platform |
| [ADR 005: Native Desktop Persistence](./decisions/005-native-desktop-persistence.md) | docs/decisions/ | Decision record for native SQLite persistence for notes, reports, and library config in the Tauri desktop app |
| [ADR 006: Cloud Sync Storage Architecture](./decisions/006-cloud-sync-storage-architecture.md) | docs/decisions/ | Decision record for cloud sync storage architecture across deployment modes |
| [ADR 007: Copy-on-Import Library](./decisions/007-multi-source-library.md) | docs/decisions/ | Decision record for copy-on-import managed library folder |
| [ADR 008: Local-First Instrumentation](./decisions/008-local-first-instrumentation.md) | docs/decisions/ | Decision record for local usage counters with user-visible stats panel, two-stream architecture |
| [ADR 009: Brand Design System](./decisions/009-brand-design-system.md) | docs/decisions/ | Decision record for emerald design system and brand identity |
| [ADR 010: Patient-to-Provider Image Sharing](./decisions/010-patient-provider-image-sharing.md) | docs/decisions/ | Decision record for DICOMweb-based patient-to-provider sharing, compliance, and phased rollout |

---

## Document Locations

Documentation is organized across three locations:

### Root Directory (`/`)

Core project documentation visible in the repository root.

```
dicom-viewer/
├── README.md              # Project overview and quick start
├── CLAUDE.md              # Technical context for Claude Code
├── AGENTS.md              # Agent workflow instructions and parallel-work rules
├── USER_GUIDE.md          # End-user documentation
├── CONTRIBUTING.md        # Contribution guidelines
├── CHANGELOG.md           # Version history
├── BENCHMARKING_RESEARCH.md     # 3D volume rendering competitive benchmarking
├── TEST_PLAN_VIEWING_TOOLS.md   # Viewing tools test plan (W/L, Pan, Zoom, Reset)
└── 3D_VOLUME_RENDERING_PLAN.md  # 3D feature roadmap
```

### docs/ Directory

Technical documentation for developers and operations.

```
docs/
├── AGENT_WORKTREES.md     # Parallel AI agent workflow rules and helper commands
├── AGENT_WORKTREES_EXPLAINER.md  # Beginner explainer for the parallel workflow
├── AGENT_LAUNCHERS.md     # Session launcher scripts for worktree creation
├── PARALLEL_EXECUTION.md  # Parallel agent execution process for large features
├── RESEARCH_POLICY.md     # Policy for benchmark/planning research docs and PRs
├── INDEX.md               # This file - master documentation index
├── API.md                 # REST API reference
├── CONFIG.md              # Configuration reference
├── DEPLOY.md              # Deployment guide
├── TESTING.md             # Testing documentation
├── BUGS.md                # Bug tracking
├── CODE_REVIEWS.md        # PR review findings and resolution status
├── desktop-library-diagnostics.md  # Desktop library scan diagnostics reference
├── planning/              # Planning and research documents
└── decisions/             # Architecture Decision Records (ADRs)
```

### docs/planning/ Directory

Plans, research (feature design + competitive intelligence), and reference materials. See [SITEMAP.md](./planning/SITEMAP.md) for full descriptions.

```
docs/planning/
├── PLANS.md                                # Chronological index of all implementation plans
├── SITEMAP.md                              # Project structure map (full index)
├── PLAN-notes.md                           # Notes feature plan
├── PLAN-tauri-desktop-app.md               # Historical Tauri desktop plan
├── PLAN-tauri-release.md                   # Tauri macOS release plan
├── SYNC-CONTRACT-V1.md                     # Cloud sync wire protocol (frozen v1)
├── RESEARCH-3d-volume-rendering.md         # 3D rendering approaches
├── RESEARCH-measurement-tool.md            # Measurement tool benchmarking
├── RESEARCH-ambra-reports_2026-02-02.md    # Ambra report handling
├── RESEARCH-ohif-reports_2026-02-02.md     # OHIF document handling
├── RESEARCH-mychart-reports_2026-02-02_2148.md  # MyChart document upload
├── RESEARCH-philips-im15.md                # Philips IM15 architecture (competitive)
├── RESEARCH-sectra.md                      # Sectra IDS7 architecture (competitive)
├── RESEARCH-visage.md                      # Visage 7 / Pro Medicus (competitive)
├── RESEARCH-ohif.md                        # OHIF Viewer (open-source, competitive)
├── RESEARCH-aws-healthlake-imaging.md      # AWS HealthLake Imaging (infrastructure)
├── RESEARCH-easyradiology.md               # easyRadiology AG (competitive)
├── RESEARCH-word-onedrive-sync-prompt_2026-03-25_1124.md  # Word + OneDrive sync architecture
├── RESEARCH-*-prompt.md                    # Research input prompts
├── RESEARCH-*-thinking.md                  # Research reasoning process
├── SECURITY-AUDIT.md                       # Application security audit (14 findings)
├── DEBUGGER-AUDIT.md                       # Comprehensive debugging audit (37 findings)
├── REMEDIATION-PLAN.md                     # Prioritized remediation plan
└── reference-guides/                       # Vendor user guides and papers
```

### docs/decisions/ Directory

Architecture Decision Records (ADRs) for significant decisions and rationale.

```
docs/decisions/
├── README.md                               # ADR template and conventions
├── 001-launch-command.md                   # Decision record for launch.command startup
├── 002-persistent-local-library.md         # Decision record for persistent DICOM library
├── 003-tauri-desktop-shell-with-shared-web-core.md  # Decision record for the Tauri desktop direction
├── 004-cloud-platform-rendering-architecture.md     # Decision record for cloud rendering architecture
├── 005-native-desktop-persistence.md       # Decision record for native SQLite persistence in Tauri
├── 006-cloud-sync-storage-architecture.md  # Decision record for cloud sync storage architecture
├── 007-multi-source-library.md             # Decision record for copy-on-import managed library folder
├── 008-local-first-instrumentation.md      # Decision record for local usage counters, two-stream architecture
├── 009-brand-design-system.md              # Decision record for emerald design system and brand identity
└── 010-patient-provider-image-sharing.md   # Decision record for DICOMweb patient-to-provider sharing
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
4. **Relevant [Research docs](#for-research)** - Prior art, competitor benchmarks, and design decisions
5. **Relevant ADR-*.md** - Canonical accepted decisions and tradeoffs

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

**RESEARCH_POLICY.md**
Policy for benchmark and planning documentation. Explains what research should be
merged, what should remain local or external, and how AI agents should curate
research before opening a docs PR.

**TESTING.md**
Comprehensive testing documentation. Covers Playwright setup, test mode architecture, helper functions (with detailed explanations of `waitForViewerReady`, `getCanvasTransform`, `performDrag`), blank slice handling, visual verification with 9-region sampling, and test limitations.

**AGENT_WORKTREES.md**
Operational rules for running multiple AI coding sessions in parallel. Defines the `local/WIP` integration role, the `codex/*` and `cc/*` branch conventions, the external worktree layout, and the helper scripts for creating, listing, and retiring agent branches.

**AGENT_WORKTREES_EXPLAINER.md**
Beginner-friendly walkthrough of the cleanup that led to the current workflow. Explains what went wrong with shared dirty state, why commits beat stashes here, why worktrees must live outside the repo root, and how to reason about multi-agent Git safety.

**BUGS.md**
Bug tracking with full context. Each bug includes how it was encountered, root cause analysis, solution, why that solution was chosen, and prevention controls. Uses a standard template for consistency.

### Planning Documentation

**SITEMAP.md**
Project structure map showing workspace layout, file organization, and current work in progress. Keep updated when adding or moving files.

**PLAN-tauri-desktop-app.md**
Historical implementation plan for the Tauri desktop shell. Restores the original 6-PR breakdown and maps it to the commits and PRs that shipped the desktop app.

**PLAN-tauri-release.md**
Release plan for shipping the Tauri desktop app as a signed, notarized macOS artifact. The official packaging path currently uses a plain DMG for reliability and defers Finder-styled DMG cosmetics to later work.

**RESEARCH-*.md**
Research documents capturing benchmarking and analysis before feature implementation. Includes competitive analysis, technology comparisons, and design rationale.

**ADR-*.md (`docs/decisions/`)**
Architecture Decision Records for significant choices. ADRs capture context, decision, alternatives, implementation details, and consequences in an append-only decision log.

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
| docs/decisions/README.md and ADR-*.md | New significant decisions, status transitions, or superseding prior decisions |

### Documentation Requirements (from CLAUDE.md)

- Keep SITEMAP.md accurate when project structure changes
- Track bugs in BUGS.md with full context (symptoms, root cause, solution, prevention)
- Record major decisions and rationale in ADRs under `docs/decisions/`
- Document "why" not just "what" - future developers need context

---

*Last updated: 2026-04-06*
