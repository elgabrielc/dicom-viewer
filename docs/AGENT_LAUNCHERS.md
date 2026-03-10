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

This repository includes two launcher wrappers:

- [scripts/ccw](/Users/gabriel/claude%200/dicom-viewer/scripts/ccw) for Claude
- [scripts/codexw](/Users/gabriel/claude%200/dicom-viewer/scripts/codexw) for Codex

Both wrappers call the shared launcher at
[scripts/agent-session-launch.sh](/Users/gabriel/claude%200/dicom-viewer/scripts/agent-session-launch.sh).

The wrappers accept launcher flags before the topic, so this works as expected:

```bash
./scripts/ccw --dry-run volume-rendering
./scripts/codexw --no-launch desktop-audit
```

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

## Usage

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

## Installation

The simplest setup is to add shell functions to `~/.zshrc` that call the repo
scripts by absolute path.

Example:

```bash
ccw() {
  "/Users/gabriel/claude 0/dicom-viewer/scripts/ccw" "$@"
}

codexw() {
  "/Users/gabriel/claude 0/dicom-viewer/scripts/codexw" "$@"
}
```

Then reload your shell:

```bash
source ~/.zshrc
```

After that:

```bash
ccw volume-rendering
codexw desktop-audit
```

---

## Repo-Specific Notes

- In this repo, Claude branches use `cc/*`, not `claude/*`.
- The launcher prefers the repo helper
  [scripts/agent-worktree-new.sh](/Users/gabriel/claude%200/dicom-viewer/scripts/agent-worktree-new.sh)
  when available so repo-specific conventions stay authoritative.
- If the helper is not available in some other repo, the shared launcher falls
  back to plain `git worktree add` with the same naming rules.

For the broader workflow and branch lifecycle, see
[docs/AGENT_WORKTREES.md](/Users/gabriel/claude%200/dicom-viewer/docs/AGENT_WORKTREES.md).
