# ADR 007: Copy-on-Import Library

## Status
Proposed

## Context

The desktop app (Tauri shell, ADR 003) currently supports a single library folder. The config stores one path (`{ folder, lastScan }`), and dropping a new folder replaces the entire library. There is no way to collect imaging from multiple sources into one library.

This is at odds with the app's core purpose: being a library where users collect all their imaging. Real-world DICOM data lives in multiple places -- hospital CDs, external drives, download folders, organized archives. Users should be able to drop a new folder and have its contents merge into their existing library, not replace it.

### The reference-in-place problem

The current architecture (ADR 002) references DICOM files in place via path strings. Extending this to multiple source folders was the initial approach explored for this ADR. That exploration revealed compounding complexity:

- **Config complexity**: An array of source folders with per-folder scan state, overlapping root detection, and canonical path resolution.
- **Offline drives**: External drives unmounting between sessions, requiring graceful degradation, cached-study visibility for unreachable roots, and per-source availability indicators.
- **Path canonicalization**: The Rust scan manifest canonicalizes paths, but the JS layer only normalizes. Symlinks and aliases of the same folder could appear as duplicate sources.
- **Cross-source merge safety**: Files from different folders with the same Study Instance UID merge into one study row. This is correct for well-formed DICOM data but dangerous with anonymized datasets that may have colliding UIDs -- silently mixing slices from different patients into one study.
- **Cache consistency**: `desktop_scan_cache` uses `path` as primary key with `root_path` as a non-unique column. A file can only retain one `root_path`, making overlapping sources (`/A` and `/A/B`) ambiguous for removal.
- **Cloud sync friction**: The sync engine would need to know about N scattered source folders, check which are mounted, track which files from which folders have been uploaded, and handle partial availability.

Every one of these problems disappears with copy-on-import.

### Benchmarks

**Horos** (macOS DICOM viewer, fork of OsiriX): Copies files into a managed `DATABASE.noindex/` folder on import, indexes in Core Data/SQLite, three-level UID dedup (Study -> Series -> SOP Instance). Drop is always additive. This is the established model in medical imaging. See [Horos research](../planning/RESEARCH-horos-library-model-prompt_2026-03-27_2021.md).

**Google Photos**: Copies files to cloud on upload. Cloud is the source of truth. Each device's local storage is a partial, disposable cache of the cloud state. SHA-256 content hashing for dedup at upload time. Complete metadata stored locally in SQLite (< 1KB per photo); image bytes on demand. Selective sync is natural: each device materializes only what it needs. See [Google Photos research](../planning/RESEARCH-google-photos-library-model-prompt_2026-03-28_0849.md).

Both systems validate the same pattern: import into a managed location, index it, sync from there.

### Relationship to cloud sync

ADR 006 defines cloud sync for notes, comments, and reports. DICOM file sync is out of scope for v1 but will follow. The storage model chosen here determines how hard that extension is:

- **Reference-in-place**: The sync engine must discover files across N folders, check drive availability, and handle partial uploads. Each device has a different filesystem layout. Complex.
- **Copy-on-import**: The managed folder is the upload source. Each device's managed folder is a local materialization of the cloud state. On a new device, it starts empty and fills as studies are pulled. The sync engine talks to one well-known location. Simple.

Selective sync becomes natural: the cloud tracks what exists, each device's managed folder contains only what's been pulled. No phantom references to files that don't exist locally.

## Decision

Adopt copy-on-import for the desktop library. When the user drops a folder, the app copies all valid DICOM files into a managed library folder, indexes them, and discards the reference to the source location. The managed folder is the single source of truth for imaging data on this device.

### Core principles

1. **Import copies all valid DICOM files.** Dropping a folder copies every valid DICOM instance into the managed library folder -- not just renderable images. SEG, SR, PR, and other non-image DICOM objects are preserved. Renderability is a UI concern (which files to display), not an import filter. The originals are untouched. The app never references external paths after import.

2. **The managed folder is self-contained.** Everything the app needs is in one location. No external dependencies, no offline drive problems, no path resolution issues. The library folder can be backed up, moved, or synced as a unit.

3. **The managed folder is a local cache of the cloud.** When cloud sync ships, the managed folder becomes the local materialization of the cloud library. Upload from here, download into here. The sync engine never needs to know the user's filesystem layout.

4. **UID-based dedup at import time.** Before copying a file, check whether its SOP Instance UID already exists in the library. Skip duplicates. Report what was added and what was skipped.

5. **Additive import, explicit removal.** Import always adds. Removing a study from the library is a separate, explicit action (delete from managed folder + remove from index). Never conflate "import" with "replace."

## Alternatives Considered

- **Multi-folder reference-in-place**: Track an array of source folder paths, scan all on launch, merge results. This was the initial direction explored in this ADR. Rejected after analysis revealed compounding complexity: overlapping roots, path canonicalization, offline drives, cross-source merge safety, cache consistency, and cloud sync friction. Every problem stems from the app not owning the files. See Context section for details.

- **Reference-in-place with collision guard**: Merge unconditionally across sources but flag studies where Patient Name differs across source roots (targeted heuristic for UID collisions from anonymized data). Recommended by hardener review. Rejected: the guard catches the symptom (metadata mismatch) but not the root cause (the app doesn't control the files). Copy-on-import eliminates the collision surface by deduplicating at import time before files enter the library.

- **Hybrid (reference for local, copy for external)**: Reference files on the main drive, copy files from external/removable drives. Rejected: two code paths, ambiguous behavior, and the user has to understand which mode applies. Simplicity wins.

- **Single-folder reference (status quo)**: Keep the current single-folder model. Rejected: doesn't serve the core product goal of collecting imaging from multiple sources.

## Design Details

### Managed library folder

Location: Tauri app data directory, under a `library/` subfolder.

```
~/Library/Application Support/com.divergent.health.dicom-viewer/
  library/                    # Managed DICOM files
    <StudyInstanceUID>/
      <SeriesInstanceUID>/
        <SOPInstanceUID>.dcm
  database.sqlite             # Existing SQLite database (ADR 005)
  reports/                    # Existing report storage (ADR 005)
```

Files are organized by DICOM UID hierarchy. This structure is:
- Deterministic (same file always goes to the same path)
- Human-navigable (a user can find a specific study in Finder)
- Dedup-friendly (existence check = file path check)
- Flat enough for filesystem performance (three levels max)

### Import pipeline

When the user drops a folder:

1. **Walk the source folder** recursively, collecting all files.
2. **Parse DICOM metadata** for each file. Any file with a valid DICOM preamble and a SOP Instance UID is a candidate for import -- not just renderable images. SEG, SR, PR, and other non-image DICOM objects are included. Non-DICOM files (JPEGs, PDFs, text) are silently skipped.
3. **Dedup check**: Does `<library>/<StudyUID>/<SeriesUID>/<SOPUID>.dcm` already exist? If yes, compare file size. If size matches, skip (true duplicate). If size differs, this is a UID collision -- flag it for the user rather than silently dropping the incoming file.
4. **Copy the file** into the managed folder at the deterministic path.
5. **Index metadata**: Store parsed metadata in the persistent index for fast launch (see Metadata Index section below).
6. **Mark renderability**: Flag files that pass `isRenderableImageMetadata()` (Study UID, pixel data, non-zero dimensions). The library UI displays only renderable files, but all DICOM instances are preserved for future features.
7. **Report results**: "Imported N files (M studies, K series). Skipped P duplicates."

Progress UI throughout -- reuse existing scan progress infrastructure.

### Import is not a scan

The current scan pipeline (`loadStudiesFromDesktopPaths`) reads metadata from files and holds path references. The import pipeline is different: it reads metadata, copies the file, then indexes the copy. The scan pipeline is reused for re-indexing the managed folder on launch, but the import pipeline is new code.

### Metadata index

The ADR uses "indexed in SQLite" to mean a persistent metadata store that survives app restarts without re-parsing files. The existing `desktop_scan_cache` table (migration 002) stores per-file metadata keyed by path, with size/mtime invalidation. This is sufficient as the persistent index for the managed folder -- same table, single root path.

`addSliceToStudies()` in `sources.js` is the in-memory assembler that builds the `state.studies` map from cached or freshly-parsed metadata. It is not itself a persistent index. The flow is: persistent index (SQLite) -> in-memory assembly (`addSliceToStudies`) -> UI display.

No new SQLite table is needed for v1. If the scan cache proves insufficient (e.g., for storing non-renderable DICOM metadata that the current schema doesn't capture), a dedicated `library_files` table can be added as a migration. But start with the existing table.

### Config schema (v1 -> v2)

```javascript
// v1 (current):
{ "folder": "/path/to/dicom", "lastScan": "2026-03-27T..." }

// v2 (proposed):
{
    "version": 2,
    "libraryPath": "<app-data>/library",
    "lastScan": "2026-03-28T..."
}
```

- `version: 2` enables migration detection.
- `libraryPath` points to the managed folder. Defaults to `<app-data>/library`. Configurable for users who want the library on a specific drive.
- `lastScan` tracks when the library was last indexed.

Migration from v1 requires care. A user with a large library folder could face a long copy operation and a significant disk-space increase. The migration must not happen automatically.

**Migration flow:**

1. On first launch with a v1 config, the app detects the old `folder` value and shows a migration prompt -- not an auto-import.
2. **Preflight check**: Calculate total size of DICOM files in the old folder. Show the user: "Your library at [path] contains N files (X GB). Importing will copy these into the app's managed folder, using approximately X GB of additional disk space. Available disk: Y GB."
3. **User confirms** before any copying begins. If they decline, the app continues with the old reference-in-place behavior until they're ready.
4. **Resumable import**: If the import is interrupted (crash, quit, power loss), it picks up where it left off on next launch. Files already copied are detected by the dedup check.
5. After successful import, the v2 config is persisted. The old folder is untouched -- the user can delete it manually if they want to reclaim space.

### Dedup strategy

**At import time**: Check file existence at the deterministic path (`<library>/<StudyUID>/<SeriesUID>/<SOPUID>.dcm`). If the file exists, compare file size against the incoming file. If sizes match, treat as a true duplicate and skip. If sizes differ, this is a UID collision -- two distinct files claiming the same SOP Instance UID. The import should flag the collision for the user rather than silently dropping the incoming file or overwriting the existing one. The collision notice should include both file sizes and source paths so the user can investigate.

Copy-on-import reduces the UID collision surface compared to reference-in-place (no cross-source merge ambiguity), but it does not eliminate it. The size check catches the most common collision case (anonymization tools generating identical UIDs for different files of different sizes). For byte-identical files with colliding UIDs, the collision is undetectable at import time -- but also harmless, since the content is the same.

**For cloud sync (future)**: SHA-256 content hash computed at import time and stored in the index. Upload skips files the cloud already has (by hash). This is the Google Photos model. Already planned in ADR 006.

### Duplicate notice

After import completes:

- All new: "Imported N files (M studies) from [folder name]"
- Mixed: "Imported N new files (M studies, K series). Skipped P duplicates already in your library."
- All existing: "All files in [folder name] are already in your library."

### Deletion semantics

"Remove from library" means: delete the file from the managed folder, remove from the SQLite index. The original file (wherever the user imported it from) is untouched -- the app doesn't track or modify source locations.

This avoids the Google Photos confusion where "delete" means different things in different contexts. Our model: import is a copy in, remove is a delete from the managed folder. No ambiguity.

### Launch behavior

1. Read `libraryPath` from config.
2. Scan the managed folder (reuse existing scan pipeline with the managed folder as the single root).
3. Use `desktop_scan_cache` for fast re-indexing (unchanged files skip parsing).
4. Display the library.

No multi-root complexity. One folder, one scan, one index.

### Disk usage

Medical imaging datasets for a personal viewer are typically a few hundred MB to a few GB per study. A large personal library might be 50-100 GB. On modern hardware with hundreds of GB to multiple TB of storage, this is manageable.

Users who want to minimize duplication can delete the original source after confirming import. The app does not do this automatically.

For cloud sync (future), selective sync means devices only pull what they need. A laptop with limited storage can keep recent studies locally and access older ones on demand.

### Phased implementation

1. **Managed folder setup**: Create the `library/` directory structure in app data. Update config schema to v2.
2. **Import pipeline**: New code path for copy + index on drop. Dedup by file path existence. Progress UI.
3. **Migration**: On first launch with v1 config, import existing library folder contents into managed folder.
4. **Remove from library**: UI action to delete a study/series from the managed folder and index.
5. **Cache cleanup**: Remove `desktop-library-cache.json` dependency.

### Files impacted

| File | Change | Phase |
|------|--------|-------|
| `docs/js/persistence/desktop.js` | v2 config schema, managed folder path | 1 |
| `docs/js/app/desktop-library.js` | Import pipeline, managed folder setup, kill snapshot methods | 1-5 |
| `docs/js/app/main.js` | `handleTauriDrop()` calls import instead of scan | 2 |
| `docs/js/app/library.js` | Import progress UI, remove-from-library action | 2-4 |
| `docs/js/app/sources.js` | No changes for scan; import pipeline is new code alongside | 2 |
| `desktop/src-tauri/src/` | Rust commands for file copy, managed folder operations | 2 |

## Consequences

Positive:

- Users can collect imaging from multiple sources into one library. This is the core value proposition of the app.
- Offline drive problems are minimized -- files are always local after import. (Note: if `libraryPath` is configured to an external drive, that drive must be mounted. This is a simpler and rarer scenario than multi-root reference-in-place, but not impossible.)
- No cross-source merge ambiguity -- dedup happens at import time by SOP Instance UID, before files enter the library.
- No path canonicalization issues -- the app owns the file paths in the managed folder.
- No multi-root config complexity -- one folder, one scan root.
- Clean path to cloud sync -- managed folder is the upload source and download destination.
- Selective sync is natural -- each device materializes only what it needs.
- Library is portable -- the managed folder can be backed up or moved as a unit.
- Matches established patterns (Horos, Google Photos).

Negative:

- Disk space duplication. Imported files are copies. Users with very large datasets on limited storage may need to delete originals after import.
- Import takes longer than reference-in-place (file copy vs. just indexing). For large folders, this could be minutes.
- Reversing the reference-in-place philosophy from ADRs 002 and 006. The reasoning has changed because the product scope has grown from "viewer" to "library with cloud sync."
- Migration from v1 requires a one-time import of the existing library folder. This must handle edge cases (permissions, disk space, interrupted import).
- The managed folder can grow large. No automatic cleanup or storage management in v1.

## Research References

- Horos library model: [RESEARCH-horos-library-model-prompt_2026-03-27_2021.md](../planning/RESEARCH-horos-library-model-prompt_2026-03-27_2021.md)
- Google Photos library model: [RESEARCH-google-photos-library-model-prompt_2026-03-28_0849.md](../planning/RESEARCH-google-photos-library-model-prompt_2026-03-28_0849.md)
- Managed folder as local cache principle: [PRINCIPLE-managed-folder-as-local-cache.md](../planning/PRINCIPLE-managed-folder-as-local-cache.md)
- ADR 002 (persistent local library -- superseded by this ADR for desktop mode): [002-persistent-local-library.md](002-persistent-local-library.md)
- ADR 005 (native desktop persistence): [005-native-desktop-persistence.md](005-native-desktop-persistence.md)
- ADR 006 (cloud sync storage architecture): [006-cloud-sync-storage-architecture.md](006-cloud-sync-storage-architecture.md)

## Review Iterations

**Review 1 (external critique of the reference-in-place draft):** Five findings about cache schema accuracy, source identity canonicalization, offline-drive behavior, series-level duplicate notice, and nondeterministic first-seen metadata. All valid, all symptomatic of the underlying complexity of managing scattered file references. This review was a factor in reconsidering the reference-in-place approach entirely.

**Review 2 (hardener analysis of merge safety):** Recommended merge-unconditionally with a targeted collision guard (compare Patient Name across source roots). Sound within the reference-in-place model, but the discussion revealed that the guard catches symptoms, not the root cause. Copy-on-import eliminates the collision surface by deduplicating at import time.

**Review 3 (cloud sync implications):** Analysis of how reference-in-place vs. copy-on-import interact with future cloud sync (ADR 006). Copy-on-import aligns with the Google Photos model: managed folder as local cache of cloud state, clean upload source, natural selective sync. Reference-in-place would require the sync engine to discover files across N folders with partial availability. This was the deciding factor.

**Review 4 (external critique of copy-on-import draft, 5 findings):**

1. **[P1] Lossy import.** The pipeline filtered on `isRenderableImageMetadata()`, meaning SEG/SR/PR and other non-image DICOM objects would never be copied. Fixed: import all valid DICOM instances, mark renderability as a UI flag, not an import filter.

2. **[P1] Aggressive v1 migration.** Auto-importing on first launch is risky for large libraries (long copy, surprise disk-space spike, interrupted-upgrade edge cases). Fixed: migration requires explicit user confirmation with a preflight check showing file count, size, and available disk. Import is resumable if interrupted. Status downgraded from Accepted to Proposed until migration UX is validated.

3. **[P2] UID collision still possible.** Copy-on-import changes the failure mode from "merge wrong files" to "silently drop a distinct colliding file." Fixed: dedup check now compares file size when the target path already exists. Size mismatch flags a collision for the user rather than silently skipping.

4. **[P2] "Indexed in SQLite" was vague.** `addSliceToStudies()` is an in-memory assembler, not a persistent index. Fixed: added Metadata Index section clarifying the flow (SQLite scan cache -> in-memory assembly -> UI display) and confirming `desktop_scan_cache` is sufficient for v1.

5. **[P3] "No offline drive problems" overstated.** If `libraryPath` is configured to an external drive, that drive must be mounted. Fixed: qualified the claim in Consequences.
