# Design Workflow

This workflow exists so future design sessions improve the system instead of
rediscovering it.

## Read Order

Before making design recommendations or changes:

1. Read `docs/design/core.md`
2. Read `docs/design/brand-system.md`
3. Read the relevant surface doc under `docs/design/surfaces/`
4. Read private collaboration preferences for the workspace
5. Review `docs/design/open-questions.md` if the task touches unresolved areas

## Standard Session Cadence

### 1. Orient

- Confirm the surface and decision scope.
- Distinguish durable brand rules from local exploration ideas.
- Check whether the task is a new direction, a refinement, or productionization
  of an already approved direction.

### 2. Explore

- Prefer HTML/CSS exploration pages for visual rounds when the work is still
  divergent.
- Offer a small number of strong options rather than a sprawling grid.
- Show realistic context when it helps evaluation, especially for icons, logos,
  and shell chrome.

### 3. Review

- Summarize the strongest differences between options.
- Under each option, include a short **Why this works** / **Why this loses**
  comparison so the tradeoff is explicit and reviewable.
- Capture what was preferred and what was rejected.
- Call out when the codebase is visually behind the selected direction.

### 4. Produce

- If a direction is clearly approved and scoped, proceed to implementation.
- If the decision changes broad visual direction, pause for confirmation before
  replacing a large surface.
- Final brand assets intended for the shipped app should prefer outlined SVG or
  equivalent production-safe assets.

### 5. Close Out

- Before compaction, handoff, or thread end after meaningful design work, write
  or update a scratch note in
  `~/.claude/agent-memory/divergent-designer/workspaces/dicom-viewer/sessions/YYYY-MM-DD.md`.
- Use `docs/design/session-closeout-template.md` to keep closeout notes
  consistent and resumable.
- Promote durable project knowledge into `docs/design/` before saving anything
  privately.
- If nothing was approved yet, still capture the current frontier and the best
  next starting point in session scratch.
- Report back what was saved to repo docs and what was saved to private memory.
- If an automated closeout reminder appears, treat closeout as the next task
  instead of normal work continuation.
- Treat the hook reminder itself as the go signal for closeout; do not wait for
  a second confirmation before saving the session state.

## Promotion Loop

Use this after each real design session.

1. Capture rough working notes in private session scratch if needed.
2. If a choice was approved, promote it into `docs/design/decisions.md` and the
   relevant canonical doc.
3. If the issue remains unresolved, add or update `docs/design/open-questions.md`.
4. If a reusable UI convention has stabilized, add or update the appropriate file
   in `docs/design/patterns/`.
5. Periodically compress `docs/design/core.md` so it stays short and useful.

## Automated Closeout Hooks

This project can use machine-local Claude hooks to reduce the chance of losing
design state across compaction boundaries.

- `UserPromptSubmit` can inject a proactive reminder when the transcript gets
  large and recent design work is detected.
- `PreCompact` can capture mechanical state into a marker file before
  compaction.
- `SessionStart` with `source=compact` can re-inject a recovery reminder after
  compaction by pointing the agent at the marker and transcript path.

The marker lives under:

`~/.claude/agent-memory/divergent-designer/workspaces/dicom-viewer/pending-closeout/`

Marker states:

- `pending`: design signal detected, closeout not yet completed
- `reminded`: a proactive or post-compaction reminder was injected
- `resolved`: closeout completed and recorded
- `stale`: unresolved marker older than the local TTL and no longer active

The marker is a machine-readable trigger and recovery record; the dated session
scratch note under `sessions/YYYY-MM-DD.md` remains the human-readable handoff
artifact that captures the actual frontier and best next starting point.

Important notes:

- The transcript-size threshold is only a heuristic and may need recalibration.
- The design signal is intentionally conservative: explicit design paths,
  transcript references to `divergent-designer`, `docs/design/`,
  `brand-system`, `logo`, `palette`, `typography`, or `wordmark`, and recent
  file changes only. In practice the local hooks combine allowlisted file
  paths, recent file mtimes anchored to the session marker, and a small
  transcript-tail keyword check to avoid false positives.
- Stale dirty files from older sessions should not trigger reminders by
  themselves; they only count when the current session also shows active design
  discussion.
- Once a marker exists for the session, file recency is anchored to the
  marker's own `first_seen_at` / `first_design_signal_at` timestamps instead of
  repeatedly inferring freshness from transcript file metadata alone.
- The local `.claude/` hook files are machine-local in this clone family because
  `.git/info/exclude` ignores `.claude/`; that is not a global repo guarantee.
  In a fresh clone, add `.claude/` to your local `.git/info/exclude` (or an
  equivalent local exclude file) before using project-local hook scripts.

## Manual Flush Prompt

Use this explicit prompt whenever a design session may compact or end, or when
the local hooks are not configured:

```text
Before this session compacts, run design closeout:
1. Write or update today's session scratch note under ~/.claude/agent-memory/divergent-designer/workspaces/dicom-viewer/sessions/YYYY-MM-DD.md using docs/design/session-closeout-template.md.
2. Promote approved durable decisions into the right docs/design files.
3. Save only collaboration preferences to private memory.
4. Tell me exactly what you saved and where.
```

## Which File To Update

- Update `brand-system.md` for tokens, typography, logo rules, and durable
  asset constraints.
- Update `principles.md` for taste, emotional target, and anti-goals.
- Update `decisions.md` for accepted or rejected directions with rationale.
- Update `open-questions.md` for unresolved issues that should survive sessions.
- Update `surfaces/*.md` for page-specific direction and constraints.
- Update `archive.md` when a new exploration corpus becomes important enough to
  reference later.

## Private Memory Rules

Private memory is for collaboration preferences and ephemeral scratch only.

Keep there:

- preferred number of variants per round
- preferred review format
- whether realistic mockups help
- communication and pacing preferences
- session scratch that captures the current frontier and next starting point

Do not keep there:

- final brand rules
- chosen token values
- approved or rejected visual directions that matter to the project

Those belong in the repo.
