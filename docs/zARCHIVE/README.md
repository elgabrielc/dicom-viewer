# zARCHIVE

Timestamped snapshots of files before deletion, rename, or heavy modification. Preserved so we can always refer back to what a file said before.

The `z` prefix sorts this folder to the bottom of `docs/` alphabetically so it does not clutter the live tree.

## When to archive

Save a snapshot here **before** any of:

- Deleting a file
- Renaming or moving a file (the original path is gone after the move)
- Removing a section (≥10 lines or a `##` heading-level section)
- Restructuring a doc (changing headings, reorganizing flow)
- Replacing a substantial portion of content

Do **not** archive for minor edits: typos, link updates, single-line tweaks, additive content.

## Naming convention

```
<original-filename-with-extension>.<YYYY-MM-DD_HHMM>.<ext>
```

The original filename leads so `ls` groups versions of the same file together. The trailing timestamp finds the most recent.

## Path mirroring

The full repo-relative path is mirrored under `zARCHIVE/`:

- Repo-root file `BENCHMARKING_RESEARCH.md` → `docs/zARCHIVE/BENCHMARKING_RESEARCH.md.<timestamp>.md`
- Nested file `docs/planning/foo.md` → `docs/zARCHIVE/docs/planning/foo.md.<timestamp>.md`

The redundant `docs/zARCHIVE/docs/...` is fine; the path is unambiguous about where the original lived.

## Mechanism

Use `cp` (preserve original; the snapshot is independent), not `mv` (which removes the original). After the snapshot is in place, proceed with the actual change.

## Why we do this

To never lose information. If a doc is restructured and we later want the prior framing or examples, we can find them here. Snapshots are read-only history; they do not get edited.
