# Bug Tracking

Active bug tracking has moved to a private companion repository:
[`elgabrielc/myradone-internal`](https://github.com/elgabrielc/myradone-internal).

## Where to file what

- **External contributors and public bug reports** -- use
  [GitHub Issues on this repo](https://github.com/elgabrielc/dicom-viewer/issues).
  This is the right entry point for anyone outside the core team.
- **Internal bug tracking with full root-cause analysis** -- lives in
  `BUGS.md` and the Issues tracker on the private `myradone-internal` repo.
  The workflow ("How We Track Bugs"), open bugs list, and post-mortems for
  resolved bugs all live there.

The private split was introduced 2026-05-11 to keep internal repro details,
references to personal data folders, and in-progress bug discussion out of
the public source.

## For maintainers

See the workflow documented at the top of `BUGS.md` in
[`myradone-internal`](https://github.com/elgabrielc/myradone-internal/blob/main/BUGS.md).
Past `BUG-NNN` entries (BUG-001 through BUG-012 at the time of the split)
remain in this file's git history if you need to look them up.
