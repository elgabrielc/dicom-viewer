# ADR 011: Linting and Formatting Strategy

## Status
Accepted

## Context

This repository mixes three source stacks:

- Browser JavaScript and CSS under `docs/` and `tests/`
- Python backend code under `server/`
- Rust desktop code under `desktop/src-tauri/`

The project already has CI smoke coverage, but it did not have consistent formatting or static analysis across those languages. With multiple human and agent contributors working in parallel, style drift and small correctness issues were easy to introduce and hard to review consistently.

## Decision

Adopt one primary formatter/linter per language area:

- **Biome 2.4.10** for JavaScript and CSS
- **Ruff 0.15.9** for Python
- **rustfmt + Clippy** for Rust

Run all of them in CI and treat formatting and lint failures as blocking.

We will not add pre-commit hooks in this pass. Local contributors can run the repository scripts directly, and CI remains the source of truth for enforcement.

## Alternatives Considered

### ESLint + Prettier (+ Stylelint)

Rejected. The repo does not need separate JavaScript formatting and linting stacks when Biome can cover the current browser/test footprint with less configuration and faster execution.

### Black + Flake8 + isort

Rejected. Ruff consolidates those concerns into a single tool with a simpler configuration surface and faster CI/runtime behavior.

### Keep Rust MSRV at 1.77.2 by replacing `LazyLock`

Rejected. The desktop code already relies on `std::sync::LazyLock`, which requires Rust 1.80. The declared MSRV was therefore already inaccurate. Updating the declared floor is clearer than carrying compatibility shims for tooling only.

## Design Details

- Biome is pinned exactly in the root `package.json` so CLI behavior stays stable across local runs and CI.
- Ruff is installed through `scripts/run-ruff.sh`, which manages a cached, versioned virtual environment outside the repository root. This avoids adding a second Python requirements file while still pinning the tool version.
- Ruff configuration lives in `ruff.toml` instead of `pyproject.toml` so Vercel preview builds do not mistake lint-only settings for an application package manifest.
- Generated and vendor JavaScript assets are excluded from Biome so linting applies only to maintained source files.
- Biome keeps the repository's existing 4-space indentation and single-quote JavaScript/CSS style, and import organization remains disabled.

## Consequences

- The first rollout creates a one-time formatting diff across JavaScript, Python, and Rust.
- Contributors gain deterministic local commands for formatting and linting.
- The Rust toolchain floor for this project becomes **1.80.0**.
- If a future formatting-only commit is created, its revision should be added to `.git-blame-ignore-revs`.
