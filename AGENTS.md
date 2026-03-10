# Agent Workflow Instructions

These instructions apply to any coding agent working in this repository.

Read these first, before editing files.

---

## Mandatory Parallel-Work Rules

1. Do not do active autonomous work directly on `main` or `local/WIP`.
2. Use one branch per agent and one worktree per branch.
3. Keep agent worktrees outside the repository root under:

   ```text
   ~/ai-worktrees/dicom-viewer/
   ```

4. Codex branches use `codex/<topic>`.
5. Claude branches use `cc/<topic>` in this repo.
6. Do not use `claude/<topic>` here because a bare `claude` branch already exists and blocks that namespace.
7. Do not use `git stash` as the normal handoff mechanism.
8. Do not use `git add -A` in the shared main checkout.
9. If you are not sure which dirty files belong to your session, stop and report instead of committing.

---

## Starting New Work

If the main checkout is clean and you are starting a new task:

```bash
npm run worktree:new -- codex <topic>
npm run worktree:new -- cc <topic>
```

Then continue only in the new external worktree.

---

## If You Are Already in the Main Checkout With Changes

If you are in `/Users/gabriel/claude 0/dicom-viewer` and already have uncommitted changes:

1. Identify exactly which files belong to your session.
2. Create a dedicated branch:

   ```bash
   git switch -c codex/<topic>
   git switch -c cc/<topic>
   ```

3. Stage only your own files explicitly.
4. Commit them.
5. Switch the main checkout back to `local/WIP`.
6. Create an external worktree for your branch:

   ```bash
   git worktree add "$HOME/ai-worktrees/dicom-viewer/codex-<topic>" codex/<topic>
   git worktree add "$HOME/ai-worktrees/dicom-viewer/cc-<topic>" cc/<topic>
   ```

7. Continue only in the external worktree.

---

## Integration and Retirement

- `local/WIP` is the integration branch.
- Integrate finished agent work into `local/WIP` by commit, not by shared dirty state.
- Retire integrated branches with:

```bash
npm run worktree:retire -- codex/<topic>
npm run worktree:retire -- cc/<topic>
```

---

## Shared Coordination Files

Treat these as integration-time files whenever possible:

- `docs/INDEX.md`
- `docs/planning/SITEMAP.md`

Do not edit them from multiple active agent branches unless the task is explicitly to
perform the integration pass.

---

## Reference Docs

For the compact workflow:

- `docs/AGENT_WORKTREES.md`

For the full beginner explanation of why this workflow exists:

- `docs/AGENT_WORKTREES_EXPLAINER.md`
