<!--
  AGENT_LAUNCHERS.md - Session launcher workflow
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Agent Launchers

The safest way to start a new AI session is to create the worktree first, then
launch the tool inside that worktree.

That avoids the failure mode where a session starts in the shared checkout and
tries to relocate later.

This repository includes two repo-local launcher wrappers:

- [scripts/ccw](../scripts/ccw) for Claude
- [scripts/codexw](../scripts/codexw) for Codex

The preferred path is to install the global commands `ccw` and `codexw` in
`~/.local/bin/`. The repo-local wrappers prefer those global commands when
available, then fall back to the repo-local shared launcher at
[scripts/agent-session-launch.sh](../scripts/agent-session-launch.sh).

The wrappers accept launcher flags before the topic, so this works as expected:

```bash
ccw --dry-run volume-rendering
codexw --no-launch desktop-audit
```

---

## Preferred Path

From any git repo:

```bash
ccw volume-rendering
codexw desktop-audit
```

Those global commands call the canonical launcher in:

```text
~/.local/bin/agent-session-launch
```

That launcher detects repo-specific tooling when available and falls back to
plain `git worktree add` when it is not.

The global path is the source of truth. The repo-local wrappers exist as a
fallback for contributors who have not installed the global commands yet.

---

## What They Do

Given a topic such as `volume-rendering`, the launcher:

1. Resolves the repository root.
2. Chooses the agent branch name:
   - Claude -> `cc/volume-rendering`
   - Codex -> `codex/volume-rendering`
3. Chooses the worktree path:
   - `~/ai-worktrees/dicom-viewer/cc-volume-rendering`
   - `~/ai-worktrees/dicom-viewer/codex-volume-rendering`
4. Reuses that branch/worktree if it already exists.
5. Otherwise creates it from the repo base branch.
6. Launches the tool from inside the worktree.

This is safer than in-session relocation because the session never begins in the
shared root checkout.

---

## Safety Rules

The launcher refuses to create a new branch/worktree from a dirty shared base
branch such as `local/WIP` or `main`.

Reason:

- a dirty shared checkout usually means there is uncaptured work already in play
- starting a new agent from the last commit while that dirty state exists is how
  changes get mixed up and lost

If the target branch already exists, the launcher reuses it instead of creating a
second copy.

---

## Repo-Local Fallback

Claude:

```bash
./scripts/ccw volume-rendering
```

Codex:

```bash
./scripts/codexw desktop-audit
```

Pass extra tool arguments after the topic:

```bash
./scripts/codexw bugfix-42 --resume
./scripts/ccw docs-cleanup --dangerously-skip-permissions
```

Dry run:

```bash
./scripts/ccw --dry-run volume-rendering
./scripts/codexw --dry-run desktop-audit
```

Prepare the worktree but do not launch the tool:

```bash
./scripts/ccw --no-launch volume-rendering
./scripts/codexw --no-launch desktop-audit
```

---

## Global Installation

After manual installation, these files should exist in `~/.local/bin/`:

- `agent-session-launch`
- `ccw`
- `codexw`

If `~/.local/bin` is already on `PATH`, no shell functions are needed.

Verify:

```bash
command -v ccw
command -v codexw
command -v agent-session-launch
```

---

## Repo-Specific Notes

- In this repo, Claude branches use `cc/*`, not `claude/*`.
- The launcher prefers the repo helper
  [scripts/agent-worktree-new.sh](../scripts/agent-worktree-new.sh)
  when available so repo-specific conventions stay authoritative.
- If the helper is not available in some other repo, the shared launcher falls
  back to plain `git worktree add` with the same naming rules.

For the broader workflow and branch lifecycle, see
[docs/AGENT_WORKTREES.md](./AGENT_WORKTREES.md).
