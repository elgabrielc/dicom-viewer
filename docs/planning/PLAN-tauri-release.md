# Tauri macOS Release Plan

## Overview

Ship the Tauri desktop app as a real macOS release artifact: signed, notarized, stapled, and downloadable as a plain DMG.

**Status**: Planned
**As of**: March 9, 2026

This plan starts after the Tauri desktop implementation work. The app already builds and runs on macOS, but the release/distribution work is still open.

Related documents:
- `docs/decisions/003-tauri-desktop-shell-with-shared-web-core.md`
- `docs/history/session-summaries.md` (historical implementation timeline)

---

## Current State

### Current artifact policy

The official release path is now a plain DMG that skips Finder window styling.

- Use `npm run build:plain-dmg` in `desktop/` for local packaging
- This path builds the `.app`, stages the app plus an `Applications` symlink, and creates a functional DMG with `hdiutil`
- It intentionally avoids the Finder AppleScript styling step used by Tauri's generated `create-dmg` flow
- Reason: on March 9, 2026 the styled DMG flow was verified to fail in automation with Finder `AppleEvent timed out (-1712)`, while the plain DMG path worked
- A polished drag-to-Applications DMG can be added later as a separate manual-release path

### Already done

- Tauri desktop shell is implemented
- Desktop library persistence is implemented
- Desktop notes/report persistence is implemented
- Native menus, icons, and general desktop productization work are implemented
- Browser regression coverage exists via Playwright
- CI already builds an unsigned macOS `.app` bundle in `.github/workflows/pr-validate.yml`

### Still missing

- Apple Developer Program enrollment and release credentials
- Developer ID signing for the shipped app
- Apple notarization and ticket stapling
- Signed DMG artifact generation in CI
- Clean-Mac install/release validation
- GitHub release publication process

### Scope decision before cutting a release candidate

Decide whether the first signed desktop release includes the native desktop decode stack (PRs `#19` through `#23`).

- If yes: merge that stack before cutting the release candidate.
- If no: cut the release from the already-merged desktop shell and ship native decode in a later release.

Do not mix that decision into the release week itself. Make it before the release candidate is frozen.

---

## Release Goal

Produce these release artifacts:

| Artifact | Purpose |
|----------|---------|
| Signed `.app` | Native macOS application bundle |
| Notarized, stapled plain `.dmg` | Public installer/download artifact |
| SHA256 checksum | Integrity verification for the published release |
| Release notes | Version, install notes, known limitations |
| Clean-Mac QA checklist | Manual release gate evidence |

---

## Release Gates

The release is not complete until all of these are true:

- `npx playwright test` passes on the release candidate commit
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml` passes
- macOS CI builds the app bundle successfully
- Signed plain DMG build succeeds in CI
- Apple notarization succeeds
- Stapling succeeds for the shipped artifacts
- Clean-Mac install/launch checklist passes end-to-end
- No blocker issues remain in launch, file access, JPEG 2000 rendering, persistence, or quit/relaunch behavior

---

## Phase 1: Freeze the Release Candidate

### Purpose

Pick the exact commit that will become the release and stop mixing feature work with release work.

### Tasks

1. Decide whether native desktop decode is in or out for this release.
2. Merge any required pre-release PRs.
3. Cut a release candidate branch or tag from `main`.
4. Stop landing unrelated feature work onto that release candidate.
5. Update `CHANGELOG.md` with the desktop release notes draft.

### Exit criteria

- One release candidate commit is identified
- Feature scope is frozen
- Release notes draft exists

---

## Phase 2: Apple Account and Credentials

### Purpose

Acquire the Apple-side prerequisites needed for public macOS distribution.

### Tasks

1. Enroll the company/app owner in the Apple Developer Program.
2. Create or confirm the Apple Team ID to use for release builds.
3. Create a `Developer ID Application` signing certificate for the shipped app.
4. Create notarization credentials for CI.
5. Store all signing/notarization material in CI secrets.

### CI inputs to prepare

- Signing certificate material
- Certificate password, if exported as a file
- Signing identity name
- Apple team identifier
- Notarization credentials or API key material

### Exit criteria

- A local test machine can sign the app
- CI has the required secrets configured

---

## Phase 3: Build, Sign, and Notarize in CI

### Purpose

Move from an unsigned build smoke to a repeatable release artifact pipeline.

### Existing baseline

`pr-validate.yml` already proves an unsigned macOS app bundle can be built:

```bash
npm run tauri build -- --bundles app
```

The plain DMG path is now a repo-owned wrapper:

```bash
npm run build:plain-dmg
```

That script:
- builds the app bundle with `tauri build -- --bundles app`
- stages `DICOM Viewer.app` plus an `Applications` symlink
- packages a plain DMG with `hdiutil`
- skips Finder AppleScript styling entirely

### Required release work

1. Add a release-oriented macOS workflow or extend the existing macOS build path.
2. Build the desktop app from `desktop/`.
3. Produce a plain DMG bundle:

```bash
npm run build:plain-dmg
```

4. Sign the generated app bundle.
5. Submit the signed artifact for notarization.
6. Staple the notarization ticket to the shipped artifact.
7. Publish the DMG and checksum as CI artifacts for the release job.

### Deliverables

- Signed `.app`
- Notarized, stapled plain `.dmg`
- SHA256 checksum file
- Build log with signing/notarization success

### Exit criteria

- CI can produce a signed, notarized, stapled plain DMG without manual patching

---

## Phase 4: Clean-Mac Release Validation

### Purpose

Validate the actual user experience on a machine that does not have a dev environment hiding packaging problems.

### Test environment

- A clean macOS machine
- No local source checkout required
- No dev certificates, local cargo toolchain, or Tauri CLI assumptions

### Manual checklist

1. Download the plain DMG from the release artifact.
2. Open the DMG and drag the app to `Applications`.
3. Launch the app through Finder.
4. Confirm Gatekeeper behavior is normal for a signed/notarized app.
5. Verify the app opens without a blank shell or missing assets.
6. Verify sample data loads.
7. Verify folder selection works.
8. Verify drag-drop loading works.
9. Verify library persistence survives relaunch.
10. Verify notes persistence survives relaunch.
11. Verify report persistence survives relaunch.
12. Verify JPEG 2000 rendering works.
13. If native desktop decode is in-scope, verify it on a real study.
14. Quit and relaunch the app; verify state and permissions behave correctly.
15. Re-test after revoking and re-granting folder access, if applicable.

### Exit criteria

- The entire install-to-use flow works on a clean machine with no release blockers

---

## Phase 5: Publish the Release

### Purpose

Turn the validated artifact into a public release that users can download confidently.

### Tasks

1. Create a GitHub release from the release candidate tag.
2. Upload the stapled plain DMG.
3. Upload the checksum file.
4. Publish release notes with:
   - version number
   - minimum supported macOS version
   - install instructions
   - known limitations
   - whether native desktop decode is included
5. Keep the previous artifact available for rollback if a hotfix is needed.

### Exit criteria

- Public release page exists
- Downloadable artifact matches the validated build

---

## Future Enhancement: Styled DMG

The Finder-styled DMG is deferred work, not the current release path.

If we revisit it later, treat it as a manual-release enhancement with its own validation:

- restore a polished Finder layout only after the AppleScript timeout is understood and reliable
- keep the plain DMG path as the automation-safe fallback
- do not block signed/notarized releases on Finder cosmetics

---

## Phase 6: Post-Release Watch

### Purpose

Handle first-release packaging and environment issues quickly.

### Tasks

1. Monitor for install failures, Gatekeeper complaints, and launch failures.
2. Watch for desktop-only decode/render bugs.
3. Watch for permission and persistence regressions.
4. Keep a fast-follow patch window open immediately after release.

### Exit criteria

- No release-blocking desktop issues are emerging
- Any hotfix work is clearly prioritized

---

## Recommended Sequence

1. Make the native-decode inclusion decision.
2. Freeze a release candidate.
3. Complete Apple enrollment and credentials.
4. Wire signing/notarization into CI.
5. Produce the first signed/notarized DMG.
6. Run the clean-Mac checklist.
7. Publish the release.

---

## Out of Scope

- Windows distribution
- Auto-updater rollout
- App Store distribution
- Cloud sync or account features
- New desktop features unrelated to shipping the existing app
