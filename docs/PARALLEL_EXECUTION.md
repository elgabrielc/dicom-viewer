# Parallel Agent Execution Process

How to plan, stage, and execute large features using parallel AI agents.

This process was developed during the cloud sync build (2026-03-25) and refined
by the failures that followed. It is designed to ship significant work in a single
session while maintaining code quality.

---

## When to use this process

- The feature touches 5+ files across multiple subsystems
- The work can be decomposed into independent lanes with disjoint file ownership
- You want to compress days of sequential work into hours
- You have a clear architectural plan (ADR or equivalent) before starting

Do not use this for small fixes, single-file changes, or exploratory work.

---

## Phase 1: Research and architecture

Before writing any code or dispatching any agent.

1. **Research the problem space.** Benchmark how others solve it. Use /research-2x
   for deep dives. Commit the curated summary, not the research exhaust.

2. **Write an ADR.** Document the decision, alternatives considered, and frozen
   invariants. This is the source of truth for all agents.

3. **Get external review.** Have the architect agent or a qualified reviewer
   critique the ADR. The reviewer must have read the current code, not just the
   ADR. One thorough review cycle beats two rubber stamps.

4. **Freeze contracts.** If agents will implement both sides of an interface
   (e.g., client and server), commit a contract document with the exact wire
   format, error codes, and semantics. Agents code against this document.

**Output:** ADR + contract doc committed to the repo.

---

## Phase 2: Plan for parallelism

Design the work so multiple agents can execute simultaneously without conflicts.

### Identify merge-conflict magnets

Before staging, check which files are monoliths that multiple agents would need
to touch. If a file is >500 lines and multiple lanes need it, add a Stage 0 that
splits it into modules first.

### Design stages with disjoint ownership

Each stage has 2-4 parallel agent lanes. Each lane owns a set of files that no
other lane in that stage touches. If two lanes need the same file, the boundary
is wrong -- move it.

**Disjoint files is necessary but not sufficient.** Also document import and
dependency relationships between lanes. If Lane B imports a utility that Lane A
creates, they cannot run in parallel -- put Lane A first in merge order, or move
them to sequential stages.

Write a master plan document with:
- Stage gates (what must be true before the stage starts)
- Lane definitions (branch name, worktree path, owned files, deliverables)
- Merge order within each stage (enforce it -- do not merge out of order)
- Import/dependency relationships between lanes
- Frozen invariants that all agents must respect
- Agent prompt template filled out for each lane (see below)

### Define shared-file ownership

Files that multiple lanes depend on (migration registration, mock setup, bootstrap
files) must be owned by exactly one lane -- typically a "core" lane that merges
first. Other lanes must not touch these files.

### Specify rolling integration

Do not wait for all lanes in a stage to complete. Merge each green lane as soon
as its dependencies are satisfied. This prevents drift and catches conflicts early.
But if the plan specifies merge order, enforce it -- do not merge a later lane
just because it finished first.

**Output:** Master plan committed or saved as a plan file.

---

## Phase 3: Mandatory preflight

**This is the most important step. Skipping it caused an 80-test CI failure.**

Follow the divergence check in
[AGENT_WORKTREES.md](AGENT_WORKTREES.md#mandatory-preflight-divergence-check).

Additionally, for parallel execution:

1. **Run the full test suite with NO exclusions:**
   ```bash
   npx playwright test
   ```
   Know your baseline. If tests fail before you start, investigate. Do not filter.

2. **Tag the branch** for rollback safety:
   ```bash
   git tag parallel-build-start-<feature>
   ```
   If the build goes sideways, you can `git reset --hard` to this tag.

**Output:** Clean, rebased working branch. 0 test failures. Tag in place.

---

## Phase 4: Execute

### Agent prompt template

Every agent dispatch must use this structure. Fill in the blanks -- do not
improvise or leave sections vague.

```
You are working in worktree: {worktree_path}
Branch: {branch_name}

## Your task
{one paragraph description}

## Read these files first
- {file1 -- for context}
- {file2 -- for context}

## Files you own (modify freely)
- {file1}
- {file2}

## Files you must NOT modify
- {file1}
- {file2}

## Contracts and invariants
- {contract reference or inline spec}
- {frozen invariant}

## Verification
Run: {test command}
Expected: {what passing looks like}

## When done
Commit with descriptive message.
Git author: Gabriel Casalduc <rgc@alumni.stanford.edu>
```

### Orchestrating running agents

Once agents are dispatched, the orchestrator's job is active monitoring and
integration -- not waiting passively for completion notifications.

**Monitor at state transitions, not on a timer:**

Don't poll every 5 minutes. Check at the moments that matter:

1. **First 2 minutes after dispatch.** Confirm the agent started, is reading
   the right files, and is in the correct worktree/branch. This is the cheapest
   catch. If an agent is reading the wrong version of a file (the 739-line
   `api.js` instead of the 1548-line one), you see it immediately.

2. **First write.** The first file edit reveals whether the agent understood
   its ownership boundary and the contract. After this point, diffs are more
   valuable than output logs.

3. **First test run.** Check the test command and output. If you see
   `--grep-invert` or "244/244" when you expect "397/397", intervene.

4. **50% of wall-clock budget.** If the agent is still reading files at this
   point, it's probably stuck.

5. **80% of wall-clock budget.** Should be in verification (running tests),
   not still writing code.

To check progress at any point:
```bash
tail -30 /private/tmp/claude-501/.../tasks/<agent-id>.output
```

**Intervention hierarchy (in order of preference):**

1. **Let it finish, reject output, re-dispatch with corrections.** Best when
   the agent is >70% done, the violation is self-contained, no cascade risk.

2. **Kill and re-dispatch with corrected prompt.** Best when the agent has
   built on a wrong assumption and the context is already polluted. This is
   the primary intervention strategy -- not SendMessage.

3. **SendMessage to redirect.** Only when the agent is early, the correction
   is a single fact, and no dependent decisions have been made yet. This is
   the exception, not the default.

Mid-stream correction rarely works once the agent has built on wrong
assumptions. The cloud sync build confirmed this: three review-fix cycles
each introduced new issues precisely because correcting mid-stream is harder
than starting clean.

**While waiting for agents (priority stack):**

1. **Review and integrate the most recently completed lane.** This is the
   highest-value activity -- it surfaces problems while you can still affect
   running agents.

2. **Update next-stage prompts.** If the just-completed lane revealed
   something (a module boundary is different than expected, an API changed),
   update the next stage's prompts now. In the cloud sync build, stale
   information propagated across stages because prompts weren't updated.

3. **Write integration notes to the master plan file.** This is your external
   memory (see context management below).

4. **Verify working branch is clean.** `git status`, test count. Takes 30
   seconds, prevents "dirty working branch" surprises.

5. **Wait. Do not context-switch to unrelated work.** Orchestrator attention
   is the scarcest resource. Boredom during a build is not a bug.

**When an agent completes:**

1. Read its completion summary.
2. Read the actual diff in the worktree:
   ```bash
   cd <worktree> && git diff HEAD~1 --stat && git diff HEAD~1
   ```
3. Verify against the plan (use the integration checklist below).
4. **Cross-reference against already-integrated lanes.** Do imports/exports
   match? Do both sides of an interface agree on error shapes, status codes,
   event names? If Lane A exports `syncOutbox` and Lane B imports
   `SyncOutbox`, neither agent's tests catch it -- only you will.
5. **Trace one data flow end-to-end.** Pick the most important operation
   (e.g., "user adds a comment, it persists, it syncs"). Read the code path
   from UI event to storage through the integrated code. Confirm it matches
   the ADR. Takes 5 minutes, catches semantic drift that no unit test finds.
   This is how you would have caught the localStorage-vs-SQLite bug.
6. If clean, cherry-pick and run full tests.
7. If not clean: small issue = fix yourself. Medium = re-dispatch the agent.
   Large or confused = re-dispatch to Codex with a clean spec.
8. Update the master plan file with the lane's status (see below).

**If the lane implements a subsystem you are not expert in:**

- Budget 2x the review time. Read slowly.
- Check implementation against the ADR and contract, not your intuition.
- If in doubt, dispatch a code-reviewer agent before integrating. One extra
  review is cheaper than three fix cycles.

**If integration reveals the merge order is wrong:**

- Do not force it. Stop, update the plan, re-sequence.
- If a completed lane needs output from a lane that hasn't merged yet,
  re-dispatch the completed lane with the new context. This is cheaper than
  debugging integration failures.

**What to watch for in diffs:**

Mechanical violations:
- Agent edited files outside its ownership list
- Agent used the wrong storage backend (localStorage vs SQLite vs server API)
- Agent hardcoded values that should come from config or contracts
- Agent's test command used `--grep-invert` or other exclusions
- Agent's exports don't match what the dispatcher/contract expects
- Agent created duplicate functionality that already exists in another module

Subtle bugs tests won't catch:
- Error handling asymmetry (one side returns `{error: '...'}`, the other
  expects an exception to be thrown)
- Event/callback name mismatches (publisher uses `sync-complete`, subscriber
  listens for `syncComplete`)
- Default value disagreements (one module assumes 30s timeout, another 60s)
- Init order violations (module A assumes `initialize()` was called before
  module B calls `read()` during startup)
- Dead code that looks alive (old code path still importable after the agent
  wrapped it in a new abstraction)
- Status code mismatches (server returns 201, test asserts 200 -- this exact
  bug caused 30 failures in the cloud sync build)

### Managing orchestrator context

A 20-agent build consumes 200-300K tokens. Beyond ~150K, reasoning quality
degrades. The orchestrator must actively manage its own context.

**Externalize state aggressively.** After each integration, append to the
master plan file:

```
## Lane <name> integrated
- Time: <timestamp>
- Commit: <hash>
- Files touched: <list>
- Tests: <pass>/<total>
- Verified against contract: yes/no
- Known issues: <any>
- Deviations from plan: <any>
```

When making decisions later, read the plan file -- don't rely on earlier
conversation context.

**Use sub-sessions for large diffs.** For lanes with >200 lines of changes,
dispatch a code-reviewer agent instead of reviewing inline. The reviewer
returns a structured verdict. This keeps the orchestrator's context lean.

**Stage boundaries are context boundaries.** At each stage boundary, evaluate:
- If cumulative context >150K tokens, strongly prefer starting a fresh
  orchestrator session with only the plan file and current branch state.
- If <150K, continue but re-read the plan file to refresh state rather
  than scrolling back through conversation.

**Never hold raw test output in context.** Hold only: pass/fail count and
names of failing tests. Read full failure details only when investigating a
specific failure, then discard.

### For each stage:

1. **Create worktrees** for all lanes in the stage:
   ```bash
   npm run worktree:new -- cc <stage>-<lane>
   ```

2. **Dispatch agents** in parallel using the template above.

3. **Rolling integration.** As each lane completes:

   **Before cherry-picking:**
   - [ ] Files modified match the lane's owned-files list (no extras, no missing)
   - [ ] No modifications to forbidden files
   - [ ] Export names / API shapes match contract doc (if applicable)
   - [ ] Agent's summary accounts for all deliverables in the plan
   - [ ] Tests pass in the agent's worktree

   **After cherry-picking:**
   - [ ] Full test suite passes on working branch (no exclusions)
   - [ ] No unresolved merge conflicts

   **Then:**
   - Clean up: `./scripts/agent-worktree-retire.sh cc/<stage>-<lane>`

4. **If a lane's output violates the architecture**, do not integrate it. If the
   agent session is still alive, send it back to fix. If the session ended,
   dispatch a fresh agent with the original prompt plus the specific violation.

5. **If tests fail after integration**, investigate immediately. Do not proceed
   to the next stage with failing tests.

### Between stages:

- Verify the stage gate is met (all deliverables present, tests pass)
- If the next stage needs a contract freeze, commit it now
- Update the master plan file with stage status (which lanes done, commit hashes)
- Create fresh worktrees for the next stage's lanes

---

## When agents stall or fail

Set a wall-clock budget per lane (30 minutes for a typical lane, 60 for complex
ones). If an agent hasn't reported completion:

1. Check its output file for progress.
2. If it's stuck (looping, waiting for input, context exhaustion), kill it.
3. Dispatch a fresh agent with the same prompt. Never try to "unstick" a
   confused agent -- the context is already polluted.

If an agent completes but its output is wrong:

1. First failure: re-dispatch with corrections.
2. Second failure: re-dispatch to Codex with a clean spec.
3. Third failure: the problem is in the plan, not the agent. Revisit the plan.

---

## Phase 5: Verify and ship

1. **Run the full test suite.** No exclusions. 0 failures.

2. **Create the PR branch** from current main (not from the working branch):
   ```bash
   git checkout -b cc/<feature> origin/main
   git cherry-pick <first-commit>..<last-commit>
   ```

3. **Run tests on the PR branch.** If they fail, fix before pushing.

4. **Push and create PR.** CI must pass.

5. **Code review.** No critical findings. If review finds issues, fix and re-push.

6. **Cleanup:**
   ```bash
   ./scripts/agent-worktree-list.sh --all    # verify no orphaned worktrees
   git worktree list                          # verify no stale worktrees
   ```

7. **Update the master plan** with final status and any incident notes.

---

## Anti-patterns

### Never exclude failing tests

`--grep-invert` to skip failures is prohibited. It masks regressions. Every
failure must be investigated. If pre-existing, prove it fails on main too.

### Never split stale files

If a file differs between your branch and main, rebase before splitting. The
agent will correctly split what it sees -- but what it sees may be incomplete.

### Never trust "tests pass" alone

The orchestrator must verify that agent output matches the architectural plan.
Check storage locations, API shapes, field names, export lists. Tests verify
behavior; the orchestrator verifies architecture.

### Never let fix cycles compound

If a fix introduces new bugs, and the next fix introduces more, stop. Hand off
to a different agent (Codex) with a clean spec. Three failed fix cycles means
the current agent has lost the thread.

### Never skip the preflight divergence check

`git log HEAD..origin/main` before every multi-agent execution. No exceptions.

---

## Roles

**Orchestrator (you or the lead Claude Code session):**
- Owns the master plan and task checklist
- Dispatches agents with detailed prompts using the template
- Owns all integration (cherry-picks, conflict resolution, test verification)
- Makes architectural decisions when agents hit blockers
- Verifies agent output against the plan before integrating
- Checkpoints state to the plan file after each integration (so a new session
  can resume if the orchestrator crashes)

**Implementation agents (subagents in worktrees):**
- Own their lane's files and nothing else
- Verify worktree path and branch before making changes
- Code against frozen contracts and invariants
- Run targeted tests in their worktree
- Report completion with summary of changes

**Review agents (architect, security-auditor, code-reviewer):**
- Critique plans before execution
- Review PRs after execution
- Findings must be addressed before merge

---

## Scaling notes

This process was tested at 5 stages / 20 agents / 87 minutes. The core
principles (disjoint ownership, rolling integration, preflight checks) scale
linearly.

For builds larger than 5 stages / 20 agents, consider:

- **Stage leads.** Delegate integration for a stage to a sub-orchestrator.
  The master orchestrator dispatches stage leads; stage leads dispatch and
  integrate their lanes; then report a single "stage complete" result back.

- **Stage squashing.** Before starting the next stage, squash the previous
  stage's changes into a single commit. Each stage starts from a clean,
  comprehensible state.

- **Branch namespacing.** Use `cc/<feature>-s<N>-<lane>` to avoid branch
  clutter. Require cleanup (retire) before starting the next stage.

---

## Checklist template

Copy this for each new parallel execution:

```
[ ] Phase 1: Research and architecture
    [ ] Problem space researched
    [ ] ADR written and reviewed
    [ ] Contracts frozen and committed

[ ] Phase 2: Plan for parallelism
    [ ] Merge-conflict magnets identified
    [ ] Stages defined with disjoint file ownership
    [ ] Import/dependency relationships documented
    [ ] Shared-file ownership explicit
    [ ] Agent prompt template filled out for each lane
    [ ] Master plan written

[ ] Phase 3: Mandatory preflight
    [ ] Divergence check (AGENT_WORKTREES.md procedure)
    [ ] Rebased if diverged
    [ ] Files-to-split compared against main
    [ ] Full test suite passes (0 failures, no exclusions)
    [ ] Working branch tagged (parallel-build-start-<feature>)

[ ] Phase 4: Execute (per stage)
    [ ] Worktrees created
    [ ] Agents dispatched with complete prompts (template)
    [ ] Each lane: agent verified worktree/branch before starting
    [ ] Each lane: files match ownership list (no extras)
    [ ] Each lane: output verified against plan before integration
    [ ] Full test suite after each integration (no exclusions)
    [ ] Stalled/failed agents re-dispatched (not "unstuck")
    [ ] All worktrees from this stage retired
    [ ] Master plan updated with stage status
    [ ] Stage gate met before next stage

[ ] Phase 5: Verify and ship
    [ ] Full test suite passes on working branch
    [ ] PR branch created from current main
    [ ] Full test suite passes on PR branch
    [ ] CI passes
    [ ] Code review: no critical findings
    [ ] All worktrees and branches cleaned up
    [ ] Master plan updated with final status
```
