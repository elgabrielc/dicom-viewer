# Changelog

All notable changes to the DICOM Viewer project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Copyright 2026 Divergent Health Technologies

## [Unreleased]

## [2026-02-01]

### Added
- Measurement tool for distance measurements on DICOM images
- Measurement deletion with three interaction methods (click, keyboard, context menu)
- Auto-start Flask server for Playwright tests
- Planning docs and bug tracking system with decision documentation
- Prevention field to bug tracking for root cause analysis

### Changed
- Simplified Flask backend by removing unused server-side APIs
- Updated CLAUDE.md with workspace structure and measurement tool documentation
- Consolidated documentation to single source of truth in docs/

### Fixed
- Test mode blank slice handling in measurement tool
- BUG-003: Playwright tests fail without Flask server (documented)

## [2026-01-28]

### Added
- Sample MRI scan with anonymized patient data
- Visual verification testing with 9-region sampling methodology
- Git Workflow Controls to CLAUDE.md

### Fixed
- Sample CT showing warning icons by passing transferSyntax correctly

## [2026-01-27]

### Added
- Phase 1 viewing tools: Window/Level, Pan, Zoom, Reset
- Automated Playwright test suite for viewing tools
- MRI support with modality-aware window/level presets
- Metadata display for DICOM studies
- Instant keyboard shortcut tooltips on toolbar buttons
- User guide rewritten for patient audience

## [2026-01-24]

### Added
- Sample CT scan for demo purposes with multiple series
- Live demo link to README
- docs/ folder for GitHub Pages hosting
- 3D volume rendering benchmarking research
- CLAUDE.md for Claude Code context

## [2026-01-23]

### Added
- Initial release: DICOM CT Viewer v1.0.0
- Web-based DICOM file viewer using Cornerstone.js
- JPEG 2000 transfer syntax support
- File upload and folder upload for DICOM files
- Series browser for multi-series studies
- Slice navigation with scroll and slider
- Basic windowing controls
- Flask backend for file serving
- Test mode API for automated testing
