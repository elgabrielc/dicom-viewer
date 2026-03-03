# Architecture Decision Records (ADRs)

This directory is the canonical record for significant architecture and implementation decisions in this repository.

ADRs answer a recurring question: why was this approach chosen over alternatives?

## When to Write an ADR

Write an ADR for decisions that are likely to be revisited later, including:

- New features with meaningful design tradeoffs
- Significant architectural choices
- Technology or dependency selections
- Decisions where future contributors might ask: "Why did we do it this way?"

ADRs are usually not needed for:

- Routine bug fixes
- Small refactors
- Obvious low-impact changes

## ADR Format

This project uses Nygard's ADR structure with additional sections for implementation detail.

```md
# ADR NNN: Title

## Status
Proposed | Accepted | Implemented | Deprecated | Superseded by ADR-NNN

## Context
What problem or need triggered this decision.

## Decision
What we chose and why.

## Alternatives Considered
What we rejected and why.

## Design Details
Specific implementation choices and their rationale.

## Consequences
What follows from this decision, including both positive and negative effects.
```

## Conventions

- Number ADRs sequentially: `001`, `002`, `003`, ...
- File naming: `NNN-short-kebab-case.md`
- Keep ADRs concise (typically 1-2 pages)
- Reasoning is immutable: do not rewrite the `Context`, `Decision`, or `Alternatives Considered` sections in older ADRs
- Status updates are allowed as implementation progresses (for example `Proposed` -> `Accepted` -> `Implemented`)
- If a decision changes, create a new ADR that supersedes the old one
- Add `Review Iterations` only when significant back-and-forth shaped the outcome

## Workflow

1. Create a new ADR with status `Proposed` or `Accepted`.
2. Link related planning or research docs when relevant.
3. Update status as implementation lands.
4. If reversed, write a new ADR and mark the old one as superseded.
