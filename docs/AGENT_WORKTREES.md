<!--
  AGENT_WORKTREES.md - Parallel AI Worktree Workflow
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Agent Worktrees

This repository supports multiple AI agents working in parallel, but only if each
agent gets its own branch and worktree.

If you want the full story of what went wrong, what we changed, and why this workflow now
looks the way it does, read [AGENT_WORKTREES_EXPLAINER.md](./AGENT_WORKTREES_EXPLAINER.md).

The core rule is simple:

- One agent
- One branch
- One worktree

Do not put autonomous agent work directly on `main` or `local/WIP`.

---

## Branch Convention

- `main` tracks `origin/main` and stays deployable
- `local/WIP` is the local integration branch
- `codex/<topic>` is a Codex agent branch
- `cc/<topic>` is a Claude agent branch in this repo

Examples:

- `codex/ohif-deep-dive`
- `codex/desktop-release-audit`
- `cc/visage-research`
- `cc/docs-cleanup`

Each topic should describe one unit of work. If the scope changes, create a new branch.

Why `cc/*` instead of `claude/*`:

- this repository already has a bare branch named `claude`
- Git cannot have both `claude` and `claude/<topic>` refs at the same time
- the helper scripts therefore reserve `cc/*` for Claude sessions here

---

## Worktree Convention

Keep linked worktrees outside the repository root.

Default location:

```text
~/ai-worktrees/dicom-viewer/
```

Directory naming:

- `~/ai-worktrees/dicom-viewer/codex-ohif-deep-dive`
- `~/ai-worktrees/dicom-viewer/cc-visage-research`

Why outside the repo:

- avoids nested-worktree noise in `git status`
- keeps editor search and filesystem scans focused
- makes active agent sessions easy to identify
- reduces accidental edits in the wrong checkout

The helper scripts below default to this layout. Override with `AI_WORKTREE_HOME` if needed.

---

## Preferred Session Start

If you are starting a fresh human-driven session, prefer the launcher wrappers instead of
opening the tool in the shared checkout first.

Examples:

```bash
./scripts/ccw volume-rendering
./scripts/codexw desktop-audit
```

Those wrappers create or reuse the correct worktree and then launch the tool from inside it.

See [AGENT_LAUNCHERS.md](./AGENT_LAUNCHERS.md) for the exact behavior and shell setup.

---

## Mandatory Preflight: Divergence Check

**Before any multi-agent work, verify the working branch is in sync with main.**

```bash
git fetch origin main
git log --oneline HEAD..origin/main   # what main has that you don't
git log --oneline origin/main..HEAD   # what you have that main doesn't
git diff --stat origin/main -- <files-you-plan-to-split-or-refactor>
```

If the working branch has diverged from main:

1. **Rebase or merge main** before dispatching agents. Otherwise agents work on
   stale code and their output will be missing functions, routes, or tests that
   exist on main.
2. **Never split or replace a file** that differs from main without reconciling
   first. The split will be correct for what the agent sees, but incomplete
   relative to main.
3. **Never exclude failing tests** to make a suite "pass." Investigate every
   failure. If it is pre-existing, verify on main before moving on.

### Why This Rule Exists

On 2026-03-25, 20 parallel agents built cloud sync infrastructure on `local/WIP`,
which had diverged from main by 40 commits. The client-split agent split `api.js`
(739 lines on local/WIP) into four modules -- but main's `api.js` was 1548 lines.
The 460-line difference (the entire desktop persistence pipeline) was silently
dropped. The orchestrator ran tests with `--grep-invert` to exclude desktop tests,
saw 244 pass, and integrated. On CI, 80 of 397 tests failed. Three review-fix
cycles introduced new bugs. The fix required a clean rewrite by a different agent.

Every failure in this chain was preventable by running `git log HEAD..origin/main`
before starting.

---

## Safe Workflow

1. **Run the divergence check above.** Rebase if needed.
2. Commit any integration state you need on `local/WIP`.
3. Create one worktree per agent branch.
4. Let each agent commit on its own branch only.
5. Review and integrate with `cherry-pick` or merge into `local/WIP`.
6. Update shared index files once during integration, not inside every agent branch.
7. Retire the agent branch only after its worktree is clean and integrated.

Shared coordination files such as [docs/INDEX.md](./INDEX.md) and
[docs/planning/SITEMAP.md](./planning/SITEMAP.md) should usually be touched only
during the integration step. Let agent branches create or update content files
first, then fold index updates in once.

If an agent needs to inherit local changes that are not on a branch yet, commit them first on `local/WIP`. Do not rely on stash as the handoff mechanism.

---

## Helper Scripts

These scripts live under [scripts/agent-worktree-new.sh](../scripts/agent-worktree-new.sh),
[scripts/agent-worktree-list.sh](../scripts/agent-worktree-list.sh), and
[scripts/agent-worktree-retire.sh](../scripts/agent-worktree-retire.sh).

Create a worktree:

```bash
./scripts/agent-worktree-new.sh codex ohif-deep-dive
./scripts/agent-worktree-new.sh cc visage-research
```

List active agent worktrees:

```bash
./scripts/agent-worktree-list.sh
./scripts/agent-worktree-list.sh --all
```

Retire an integrated agent branch:

```bash
./scripts/agent-worktree-retire.sh codex/ohif-deep-dive
./scripts/agent-worktree-retire.sh --delete-remote cc/visage-research
```

The retire command refuses to proceed if:

- the branch is not merged into `local/WIP`
- the branch is still checked out in the current worktree
- the attached agent worktree has uncommitted changes

---

## Suggested Daily Pattern

Start a parallel session:

```bash
git switch local/WIP
git status --short
git add <explicit-path-1> <explicit-path-2>
git commit -m "wip: integration checkpoint"

./scripts/agent-worktree-new.sh codex ohif-deep-dive
./scripts/agent-worktree-new.sh cc visage-research
```

If `local/WIP` is already clean, skip the checkpoint commit.

Integrate finished work:

```bash
git switch local/WIP
git cherry-pick <commit-from-codex-branch>
git cherry-pick <commit-from-claude-branch>
```

Retire cleanly:

```bash
./scripts/agent-worktree-retire.sh codex/ohif-deep-dive
./scripts/agent-worktree-retire.sh cc/visage-research
```

---

## Operational Rules

- Never run two agents on the same branch.
- Never delete a branch without checking whether a worktree is attached.
- Never assume uncommitted changes belong to the current session.
- Prefer cheap local commits over stashes.
- Keep agent branches narrow and disposable.
- **Never exclude failing tests.** Do not use `--grep-invert`, `--ignore`, or
  similar flags to skip test failures during integration. Every failure must be
  investigated. If a test is pre-existing, verify it fails on main too.
- **Never split or refactor files that have diverged from main.** The agent will
  work on a stale version and silently drop code. Rebase first.
- **Run the full test suite at every integration checkpoint.** No exclusions.
