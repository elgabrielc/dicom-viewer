# Design Session Closeout Template

Use this before auto-compaction, handoff, or thread end after meaningful design
work.

The goal is simple:

- save ephemeral session state to private scratch
- promote durable project knowledge into `docs/design/`
- make the next design session easy to resume

## Private Scratch Location

Write or update:

`~/.claude/agent-memory/divergent-designer/workspaces/dicom-viewer/sessions/YYYY-MM-DD.md`

## Template

```md
# Design Session - YYYY-MM-DD

## Scope

- surface or asset:
- task type: exploration / critique / implementation / consolidation

## What Was Reviewed

- files, artifacts, or mockups reviewed:
- key options or directions compared:

## Approved Durable Decisions

- decision:
  promote to:
- decision:
  promote to:

## Still Unresolved

- unresolved issue:
  promote to: docs/design/open-questions.md

## Patterns Promoted

- pattern:
  promote to:

## Collaboration / Process Notes

- private-memory-only observation:

## Current Frontier

- best next starting point:
- first files to read next time:

## Artifacts

- external exploration files or screenshots worth reopening:
```

## Classification Rule

- If it changes project truth, put it in `docs/design/`.
- If it is only about how the user likes to work, put it in private memory.
- If it is just today's in-progress state, put it in session scratch.

## Copy-Paste Flush Prompt

```text
Before this session compacts, run design closeout:
1. Write or update today's session scratch note under ~/.claude/agent-memory/divergent-designer/workspaces/dicom-viewer/sessions/YYYY-MM-DD.md using docs/design/session-closeout-template.md.
2. Promote approved durable decisions into the right docs/design files.
3. Save only collaboration preferences to private memory.
4. Tell me exactly what you saved and where.
```
