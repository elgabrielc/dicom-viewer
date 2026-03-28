# Horos Library & Database Model -- Research Findings

## 1. File Storage: Copy vs Reference

Horos supports **both** modes, tracked per-image:

- Each `DicomImage` Core Data entity has a `storedInDatabaseFolder` boolean
- **Copy mode**: Files are renamed to numeric filenames and moved into `DATABASE.noindex/` under numbered subdirectories (up to 10,000 files each)
- **Reference mode**: The original absolute path is stored; the file stays where it is

This is a per-file property, not a global toggle -- a single library can have a mix of copied and referenced files.

## 2. Drag-and-Drop Import

The import pipeline (`addFilesAndFolderToDatabase:`) works as follows:

1. Recursively enumerates dropped directories
2. Handles ZIP extraction and DICOMDIR parsing automatically
3. Filters out known non-DICOM extensions
4. Parses DICOM metadata from each file
5. Applies the user's copy/reference preference
6. Indexes everything into Core Data (Study -> Series -> Image hierarchy)

Drop is always **additive** -- new studies/series/images are added to the existing library. There is no "replace" behavior.

## 3. Duplicate Detection

Three-level UID matching:

- **Study**: `StudyInstanceUID` (0020,000D) -- if a study with this UID already exists, it is reused
- **Series**: `SeriesInstanceUID` (0020,000E) -- same, nested under the matched study
- **Image**: `SOPInstanceUID` (0008,0018) -- if the exact image already exists, it can be skipped or its metadata refreshed

A `rereadExistingItems` flag controls whether metadata is refreshed on collision. By default, exact duplicates (same SOP Instance UID) are recognized and not re-imported.

## 4. Database Folder Structure

```
Horos Data/
  DATABASE.noindex/          # Copied DICOM files (numbered subdirs, 10K files each)
  INCOMING.noindex/          # Staging area for imports in progress
  DECOMPRESSION.noindex/     # Temp space for decompressing files
  TEMP.noindex/              # General temp files
  NOT READABLE/              # Files that failed to parse
  REPORTS/                   # Generated reports
  ROIs/                      # Region of interest data
  Database.sql               # Core Data SQLite database
  DB_VERSION                 # Text file with model version ("2.5")
```

The `.noindex` suffix prevents Spotlight from indexing DICOM files (performance + privacy).

## 5. Multiple Library Locations

Horos has a multi-source architecture, but only **one source is active at a time**:

- Default local database (the main library)
- Additional local paths (user-configured)
- Remote OsiriX/Horos servers
- DICOM nodes (PACS)
- Auto-detected mounted volumes
- Bonjour-discovered services

Users can switch between sources, but there is no "merged view" across multiple sources.

## 6. Copy vs Reference Choice

Controlled by two preferences:

- `COPYDATABASE` (boolean) -- master toggle for whether to copy at all
- `COPYDATABASEMODE` -- how to decide:
  - `0` = Always copy
  - `2` = Copy only if source is not on the main drive
  - `3` = Ask the user each time (default)

When the user is asked, the dialog offers:
- **Copy** -- file is moved into `DATABASE.noindex/`, `storedInDatabaseFolder=YES`
- **Copy Links** -- file stays in place, `storedInDatabaseFolder=NO`, absolute path is stored

## 7. Import UX

- Background thread with progress bar (0.0 to 1.0)
- Status messages throttled to 0.5s updates (not every file)
- Cancellation support
- Chunked processing (batches of ~20K files)
- Per-error handling:
  - Unparseable files moved to `NOT READABLE/`
  - Password-protected ZIPs trigger a prompt
  - Failed DICOMDIR falls back to full directory scan
- Non-blocking -- user can continue browsing the library during import

## 8. Library Persistence

- **Core Data** with SQLite backing (`Database.sql`)
- Three main entities: `DicomStudy`, `DicomSeries`, `DicomImage` (plus `DicomAlbum` for organization)
- `NSConfinementConcurrencyType` threading model with recursive locks for file operations
- Automatic lightweight migration when the model version changes
- The index can be fully rebuilt by rescanning `DATABASE.noindex/` (the files are the source of truth, not the database)

## Key Takeaways for Our Design

1. **Copy-by-default with reference option** is the Horos model. Most users want files organized in one place.
2. **Per-file tracking** of copied vs referenced is important -- not a global setting.
3. **Three-level UID dedup** is standard and reliable.
4. **Additive import is the only behavior** -- drop always adds, never replaces.
5. **Background import with progress** is expected UX.
6. **Single active source** -- Horos does not merge multiple folders into one view.
