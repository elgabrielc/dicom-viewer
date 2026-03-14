<!--
  AGENT_WORKTREES_EXPLAINER.md - Beginner explainer for parallel AI sessions
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Parallel Agent Cleanup Explainer

This document explains, step by step, what we did to clean up a repository that had
multiple AI sessions working in parallel, why each step mattered, and what workflow
should be used from now on.

This is the detailed companion to [AGENT_WORKTREES.md](./AGENT_WORKTREES.md).

---

## Who This Is For

This guide is written for someone who is comfortable using Git at a basic level but
does not want to think about Git internals every time they open another AI session.

If you only want the operating rules, read [AGENT_WORKTREES.md](./AGENT_WORKTREES.md).
If you want to understand the reasoning behind those rules, read this document.

---

## The Short Version

The main lesson is:

1. Do not let multiple AI sessions work in the same checkout.
2. Do not let multiple AI sessions share the same branch.
3. Use cheap commits instead of stashes to preserve unfinished work.
4. Keep agent worktrees outside the repository root.
5. Use `local/WIP` as an integration branch, not as a shared scratchpad for active agents.

In this repository, Claude sessions use `cc/<topic>` rather than `claude/<topic>`
because a bare branch named `claude` already exists and blocks the `claude/*` namespace.

---

## The Core Git Concepts

Before the cleanup steps make sense, it helps to define a few terms.

### `origin/main`

This is the remote-tracking reference for the main branch on GitHub. It tells you what
the upstream repository currently considers the latest mainline state.

### `main`

This is your local branch named `main`. It should usually be aligned with `origin/main`.
It is not a good place to do experimental or concurrent local work.

### `local/WIP`

This is a local integration branch used as a landing zone for work that has not been
pushed upstream yet. It is useful, but it is not safe as a shared active branch for
multiple autonomous agents.

### Branch

A branch is just a named pointer to a commit. If multiple agents move the same branch
tip around or leave different uncommitted changes on top of it, ownership becomes unclear.

### Worktree

A worktree is a separate checked-out directory linked to the same Git repository. A
worktree lets you have multiple branches checked out at the same time in different folders.

This is the key tool for parallel AI work.

### Shared Checkout

The shared checkout is the main repository folder for this clone:

```text
<repo-root>
```

This checkout is convenient for you as the human integrator, but it is a bad place to
run multiple autonomous sessions because they can all see and modify the same files.

---

## What Went Wrong

At the start of the cleanup, several things were mixed together in the same repository:

1. A feature branch that had already been merged upstream.
2. A local `local/WIP` branch that had fallen behind.
3. Uncommitted documentation work sitting directly in the main checkout.
4. Nested worktree folders inside `.claude/`, which showed up as local filesystem noise.
5. Multiple AI sessions creating or updating files in the same checkout.
6. Unclear ownership of some files, especially research drafts and shared index files.

That is a dangerous state because it becomes easy to:

- lose work by cleaning the wrong files
- commit someone else’s changes by mistake
- delete a branch that still has an attached worktree
- keep using stale branches because the current state is hard to interpret

---

## What We Did

This section walks through the cleanup in the order it happened.

### 1. Checked the Branch Status

The first step was to inspect:

- the current branch
- the dirty state of the working tree
- branch tracking status
- how the current branch compared with `origin/main`

Why:

- You should not clean anything until you know whether the branch is finished, stale,
  ahead, behind, or already merged.

What we found:

- the current feature branch had already been merged into `origin/main`
- the worktree itself was dirty
- `local/WIP` existed, but it was stale relative to current mainline history

### 2. Chose Commits Over Stash

You explicitly said you did not want to keep relying on `git stash`.

That was the right instinct.

Why stash was the wrong tool here:

- stash is temporary and easy to forget
- stash does not explain ownership
- stash makes multi-session cleanup harder because it hides work rather than giving it a home
- stash is especially bad when several agents are already mixing state in one checkout

Why commits were better:

- commits are visible
- commits are attributable
- commits survive cleanup operations
- commits can be moved, cherry-picked, reviewed, and retired safely

### 3. Moved `local/WIP` and `main` Up to Current Mainline

Because the old branch was already merged, we repointed:

- `local/WIP` to the current `origin/main`
- `main` to the current `origin/main`

Then we switched the shared checkout to `local/WIP`.

Why:

- this turned the shared checkout into an integration branch based on current upstream state
- it let us stop treating a stale branch as active work
- it avoided an unnecessary stash-based branch hop

This matters because branch names should reflect reality. A stale `local/WIP` branch is
worse than useless if it makes you think you are resuming current work when you are not.

### 4. Hid `.claude/` in Local Excludes

The repository had nested worktree and settings files under `.claude/`. Those files were
not intended for version control, but they were still being seen by Git as local noise.

We added `.claude/` to:

```text
.git/info/exclude
```

Why that file:

- it behaves like a local-only `.gitignore`
- it is not committed
- it keeps your personal machine-specific clutter out of `git status`

Why this is better than editing `.gitignore`:

- `.gitignore` is shared project policy
- `.git/info/exclude` is local machine policy
- `.claude/` here was a local workflow artifact, not a repository artifact

Important limitation:

- this did not delete `.claude/`
- this did not remove the worktrees
- it only stopped the shared checkout from reporting them as untracked noise

### 5. Committed the Real Documentation Work

There was a genuine set of documentation and audit files in the working tree that you
wanted to keep. We staged those files explicitly and committed them on `local/WIP`.

Why:

- they were real work, not temporary clutter
- committing them put them on solid ground
- a commit is a better checkpoint than a stash

This also separated "valuable project work" from "workflow noise".

### 6. Deleted the Already-Merged Branch Safely

Once we confirmed that the finished feature branch was:

- already merged
- not attached to any active worktree

we deleted it locally and remotely.

Why:

- merged branches that are no longer in use add cognitive clutter
- fewer stale branches means fewer chances to resume the wrong line of work

Why the worktree check mattered:

- deleting a branch that is still checked out in another worktree is a good way to break
  someone else’s active session

### 7. Investigated the Mystery Research Files

We then found new files, such as the Visage research document, that had no Git history.

Instead of guessing where they came from, we traced their provenance through local session
logs and file timestamps.

Why:

- in a multi-agent environment, "untracked file" does not mean "safe to delete"
- provenance matters before cleanup

What we found:

- another AI session had created or renamed those files
- the same session had also updated shared coordination files such as `docs/INDEX.md`
  and `docs/planning/SITEMAP.md`

That discovery is what forced the stricter workflow rules.

### 8. Identified the Real Process Problem

The real problem was not one bad file. It was the lack of a strict parallel-work model.

Multiple sessions were effectively using:

- the same main checkout
- overlapping branch space
- shared uncommitted state
- shared coordination files

That is manageable for a human and a small amount of manual work. It is not manageable
for multiple autonomous agents acting in parallel.

### 9. Standardized the New Workflow

We introduced a simple model:

1. `main` mirrors upstream.
2. `local/WIP` is the integration branch.
3. Every active agent gets its own branch.
4. Every active agent gets its own external worktree.
5. Integration happens later by commit, not by shared dirty state.

This is the foundation of the new workflow.

### 10. Added Helper Scripts

We added three scripts:

- [scripts/agent-worktree-new.sh](../scripts/agent-worktree-new.sh)
- [scripts/agent-worktree-list.sh](../scripts/agent-worktree-list.sh)
- [scripts/agent-worktree-retire.sh](../scripts/agent-worktree-retire.sh)

Why:

- the workflow needs to be easy enough to use consistently
- good process fails if it requires too much memory or too many manual steps

These scripts now provide:

- safe creation of agent branches and worktrees
- visibility into active agent branches
- safe retirement of integrated branches

### 11. Discovered the `claude/*` Namespace Collision

While cleaning up the active Claude sessions, we found a Git namespace issue:

- the repository already had a branch named `claude`
- Git therefore could not create `claude/<topic>`

Why this happens:

- Git stores refs as paths
- `claude` and `claude/something` cannot both exist as branch refs

That meant the original convention was wrong for this repository.

### 12. Switched Claude Sessions to `cc/*`

We updated the workflow so:

- Codex uses `codex/<topic>`
- Claude uses `cc/<topic>`

The helper script also accepts `claude` as an input alias, but internally maps it to `cc/*`.

Why:

- it preserves a readable namespace for Claude sessions
- it avoids the collision with the existing `claude` branch
- it means older prompts can still use `claude` without breaking the script

### 13. Cleaned Up the Still-Running Claude Sessions

For each running Claude session, the goal was:

1. preserve its work
2. get it off the shared checkout
3. move it into its own branch and worktree

The safe pattern was:

1. identify which files actually belonged to that session
2. create a `cc/<topic>` branch
3. stage only those files explicitly
4. commit them
5. create an external worktree for that branch
6. continue working only in the external worktree

Why explicit staging mattered:

- `git add -A` in a mixed shared checkout can silently capture someone else’s work

This was the single most important safety rule during cleanup.

### 14. Verified the Session Reports

We then checked each session’s report against a simple checklist:

- branch starts with `cc/`
- worktree path is outside the repository root
- the session is not still working in the main checkout
- dirty state is either none or clearly confined to that dedicated worktree

Why:

- cleanup is not complete just because a session says it is done
- the report format made it easy to validate correctness quickly

---

## Why External Worktrees Matter So Much

This point deserves its own section.

Keeping worktrees outside the repository root means:

- the main checkout does not recurse into other checkouts
- `git status` stays easier to interpret
- editor search stays focused
- file indexing and backups are cleaner
- it is visually obvious which directory belongs to which agent

The standard path is now:

```text
~/ai-worktrees/dicom-viewer/
```

Examples:

- `~/ai-worktrees/dicom-viewer/codex-ohif-deep-dive`
- `~/ai-worktrees/dicom-viewer/cc-rendering-correctness-tier1`

This is much safer than hiding worktrees under `.claude/worktrees/...` inside the repo.

---

## Why `local/WIP` Still Exists

It is reasonable to ask: if every agent gets its own branch, why keep `local/WIP`?

Because `local/WIP` is still useful as:

- your local integration branch
- the place where you cherry-pick or merge approved agent commits
- the branch that reflects "my current combined local state"

What `local/WIP` should not be:

- a branch shared by multiple active agents
- a long-lived anonymous scratchpad full of uncommitted files

So the rule is:

- active agent work happens on `codex/*` or `cc/*`
- integrated local state lives on `local/WIP`

---

## The New Normal Workflow

### Starting New Parallel Work

1. Make sure `local/WIP` contains any local base state you want agents to inherit.
2. Commit that base state if needed.
3. Create an agent worktree:

```bash
npm run worktree:new -- codex ohif-deep-dive
npm run worktree:new -- cc visage-research
```

4. Open the new worktree path.
5. Let that agent work only there.

### Checking What Is Active

Use:

```bash
npm run worktree:list
npm run worktree:list:all
```

This tells you:

- which agent branches exist
- where they are checked out
- whether their worktrees are clean or dirty

### Integrating Finished Work

From `local/WIP`:

```bash
git switch local/WIP
git cherry-pick <agent-commit>
```

or, if you intentionally prefer it:

```bash
git merge <agent-branch>
```

The important point is that integration happens by commit, not by reusing the same dirty
checkout for everybody.

### Retiring Finished Branches

After work is integrated and the agent worktree is clean:

```bash
npm run worktree:retire -- cc/visage-research
```

The retire script refuses unsafe removals, which protects you from deleting a branch that
still has an attached or dirty worktree.

---

## Practical Rules to Remember

If you remember nothing else, remember these:

1. One agent, one branch, one worktree.
2. Never let autonomous agents share `local/WIP`.
3. Never use `git add -A` in a dirty shared checkout.
4. Prefer commits over stashes.
5. Keep worktrees outside the repository root.
6. Treat `docs/INDEX.md` and `docs/planning/SITEMAP.md` as integration files whenever possible.
7. For Claude sessions in this repo, use `cc/*`, not `claude/*`.

---

## What "Clean" Looks Like Now

A healthy setup now looks like this:

- `main` follows `origin/main`
- `local/WIP` contains only your integrated local work
- each active AI session appears as its own `codex/*` or `cc/*` branch
- each active AI session has its own worktree under `~/ai-worktrees/dicom-viewer/`
- the main checkout is reserved for you as the integrator, not for parallel agents

That is the point of all this cleanup: not just to fix one messy moment, but to make the
next ten parallel sessions predictable and safe.
