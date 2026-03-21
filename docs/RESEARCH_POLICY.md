<!--
  RESEARCH_POLICY.md - Policy for benchmark, planning, and research documentation
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Research Documentation Policy

This document defines what research belongs in the repository, what should stay
local or external, and when benchmark or planning documentation should go through
a pull request.

The goal is simple:

- keep durable decision support in the repo
- keep scratch research clutter out of `main`
- make it easy for humans and AI agents to know what to commit

---

## Default Rule

Commit curated conclusions, not the full research exhaust.

Research artifacts should be treated in three categories:

1. **Ephemeral research**
   - raw notes
   - copied links
   - prompt files
   - AI "thinking" files
   - partial comparisons that may change quickly

2. **Durable decision support**
   - benchmark summaries
   - architecture comparisons
   - competitive research that informs roadmap or product direction
   - implementation recommendations

3. **Canonical decisions**
   - ADRs
   - accepted plans
   - documents that define the current project direction

Only categories 2 and 3 normally belong in the repo.

---

## What Should Be a PR

Open a docs PR when the research is expected to matter later.

That usually means one or more of:

- the document informs an ADR, roadmap, or implementation plan
- future contributors or AI agents should be able to rely on it
- the conclusions are stable enough to survive beyond the current session
- the research compares options the team is likely to revisit
- the document will be cited in future planning or implementation work

Examples:

- a competitive benchmark that informs cloud-platform architecture
- a feature-design research summary that drives implementation
- a plan document that maps research into staged execution
- an ADR that records the accepted decision

---

## What Should Not Be a PR By Default

Do not put raw process artifacts on `main` unless there is a clear reason to keep them.

That usually includes:

- `RESEARCH-*-prompt.md`
- `RESEARCH-*-thinking.md`
- local scratch notes
- copied web excerpts
- half-finished exploratory writeups
- AI-generated research transcripts

These can live:

- locally in the agent worktree while the session is active
- in external planning tools if the team uses them
- in a temporary branch until the final research summary is curated

If traceability matters, include a short **Method** or **Sources** section inside
the main research summary instead of keeping separate prompt/thinking files.

---

## Benchmarking Research Workflow

For benchmarking and competitive research, use this workflow:

1. **Research phase**
   - let the agent create whatever scratch files it needs
   - do not assume those files all belong in the repo

2. **Curation phase**
   - keep one durable summary document if the work is decision-relevant
   - fold source links, confidence notes, and major caveats into that document
   - update an ADR or plan if the research changes project direction

3. **PR phase**
   - PR the curated summary
   - PR the ADR or plan update if applicable
   - do not PR prompt/thinking companions unless explicitly requested

4. **Integration phase**
   - update [INDEX.md](./INDEX.md) and [SITEMAP.md](./planning/SITEMAP.md) only for
     durable documents that should be discoverable later

---

## File Conventions

Use these file types deliberately:

- `docs/planning/RESEARCH-<topic>.md`
  - curated research summary
  - appropriate for benchmark writeups and feature research

- `docs/planning/PLAN-<topic>.md`
  - implementation plan based on accepted research
  - appropriate when the team is deciding how to execute

- `docs/decisions/<nnn>-<topic>.md`
  - accepted architectural or product decision
  - appropriate when the direction is no longer provisional

Avoid treating these as first-class tracked artifacts by default:

- `docs/planning/RESEARCH-<topic>-prompt.md`
- `docs/planning/RESEARCH-<topic>-thinking.md`

Those companion files should be tracked only when the user explicitly asks to keep
the research process itself.

---

## AI Agent Rules

When an AI agent produces research in this repo:

1. Assume only the main summary belongs in git unless told otherwise.
2. Do not commit prompt/thinking files by default.
3. If the branch contains both durable docs and scratch artifacts, stage only the
   durable docs explicitly.
4. If the research changes architecture or roadmap direction, update the related
   ADR or plan in the same PR when practical.
5. If unsure whether the document is durable or ephemeral, ask before committing.

This keeps the repo useful as a knowledge base instead of turning it into an
archive of every intermediate AI artifact.

---

## Review Checklist

Before opening a research docs PR, check:

- Is this document likely to be useful in 1-3 months?
- Does it inform a real product or technical decision?
- Could a new contributor or AI agent rely on it directly?
- Are prompt/thinking artifacts excluded unless explicitly approved?
- Does the document clearly separate confirmed facts from inference?

If the answer to the first three questions is mostly "no", the work probably
should not be merged to `main`.

---

## Repository-Specific Default

In this repository:

- benchmark and competitive research summaries may be merged when they support
  roadmap, cloud-platform, or implementation decisions
- prompt and thinking companions should stay local by default
- ADRs and accepted plans should always go through normal PR review

The expected end state is:

- one durable summary when the research matters
- one ADR or plan update when the decision is real
- no extra prompt/thinking noise unless someone explicitly wants it preserved
