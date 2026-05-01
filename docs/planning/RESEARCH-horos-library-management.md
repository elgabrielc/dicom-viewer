# Research: Horos Library and Database Management

**Date**: 2026-03-27
**Purpose**: Understand how Horos (open-source OsiriX fork) handles its DICOM image library,
database structure, import behavior, and file management. Inform design of our own library
persistence layer.

**Sources**: Horos GitHub repository (https://github.com/horosproject/horos), OsiriX Wikibooks
documentation, Horos user guides.

---

## 1. How Horos Stores References to DICOM Files

Horos supports **both** copying files into its database folder and referencing them in place.
The behavior is tracked per-image via a Core Data attribute.

### The `storedInDatabaseFolder` Flag

Each `DicomImage` entity has a boolean attribute `storedInDatabaseFolder`:

- When `YES` (or `nil`, which defaults to `YES`): the DICOM file lives inside
  `DATABASE.noindex/` under the Horos data directory. The `pathString` is stored as a
  **relative** numeric path (e.g., `12345.dcm`).
- When `NO`: the DICOM file lives at its original external location. The `pathString` is
  stored as an **absolute** path (e.g., `/Volumes/External/patient/image.dcm`).

### Path Resolution Logic

The `completePath` method on `DicomImage` determines the actual file location:

```
if path starts with "/" -> absolute path, return as-is (external reference)
if path does NOT start with "/" -> relative to DATABASE.noindex, compute subfolder
```

Relative paths are resolved via `completePathForLocalPath:directory:`, which computes the
subfolder index: `val = floor(numericFilename / DefaultFolderSizeForDB) + 1) *
DefaultFolderSizeForDB`. With the default folder size of 10,000, file `12345.dcm` lives at
`DATABASE.noindex/20000/12345.dcm`.

**Source files**: `Horos/Sources/DicomImage.m`, `Horos/Sources/DicomImage.h`

---

## 2. Drag-and-Drop Folder Import Behavior

When files or folders are dropped onto the Horos browser window, the method
`addFilesAndFolderToDatabase:` handles the operation:

### Processing Steps

1. **Recursive enumeration**: Directories are recursively scanned. Hidden files (starting
   with `.`) are skipped. `.app` and `.pages` bundles are skipped.
2. **Special file handling**:
   - `.zip` / `.osirixzip` files: unzipped (with optional password prompt), then contents
     scanned recursively.
   - `DICOMDIR` files: parsed via `DicomDirParser` for efficient metadata extraction.
   - `.dcmURLs` files: trigger WADO (web) downloads.
3. **Extension filtering**: Files with extensions `.jpg`, `.tif`, `.mp4`, `.mov`, `.avi`,
   `.html`, `.doc`, `.txt`, `.exe` are skipped during directory scans. Remaining files are
   validated with `DicomFile isDICOMFile:`.
4. **Copy decision**: After file enumeration, `copyFilesIntoDatabaseIfNeeded:options:` is
   called, which applies the user's copy preference (see section 6).
5. **Database indexing**: Files are added to Core Data via
   `addFilesDescribedInDictionaries:...` which extracts DICOM metadata and creates/updates
   Study, Series, and Image entities.

### Threading

The entire operation runs on a background thread via `ThreadsManager`. The UI thread receives
progress updates and remains responsive during import.

**Source files**: `Horos/Sources/BrowserController.m`

---

## 3. Duplicate Study/Series Handling on Import

Horos uses a **three-level DICOM UID hierarchy** for duplicate detection:

### Detection Strategy

| Level | Key Attribute | DICOM Tag |
|-------|--------------|-----------|
| Study | `studyInstanceUID` | (0020,000D) |
| Series | `seriesInstanceUID` | (0020,000E) |
| Image | `SOPUID` (SOP Instance UID) | (0008,0018) |

### How It Works

In `addFilesDescribedInDictionaries:...` (the core import method in `DicomDatabase.mm`):

1. **Study lookup**: The `studiesArrayStudyInstanceUID` index (an in-memory dictionary) is
   checked for matching `studyInstanceUID`. If found, the existing study is reused.
2. **Patient validation**: If the `studyInstanceUID` matches but the `patientUID` differs
   (case-insensitive, diacritic-insensitive comparison), a warning is logged. CD media is
   treated more permissively via `hasPotentiallySlowDataAccess`.
3. **Series lookup**: Within the matched study, the `series` set is searched for a matching
   `seriesInstanceUID`.
4. **Image lookup**: Within the matched series, existing images are checked by `SOPUID`.

### Merge Behavior

- If a Study already exists, new Series are added to it. Study metadata may be updated.
- If a Series already exists, new Images are added to it.
- If an Image with the same SOP Instance UID already exists, behavior depends on the
  `rereadExistingItems` parameter: if `YES`, metadata is re-extracted from the file; if `NO`,
  the duplicate is skipped.
- Special case: "empty placeholder" studies (single series with id=5005, name="OsiriX No
  Autodeletion") are treated as new objects rather than duplicates.

### OsiriX-Generated Content

Structured Reports with specific series descriptions ("OsiriX Annotations SR", "OsiriX ROI
SR", "OsiriX Report SR", "OsiriX WindowsState SR") trigger `inParseExistingObject = YES`,
meaning they always re-read/update existing records.

**Source files**: `Horos/Sources/DicomDatabase.mm`, `Horos/Sources/DicomDatabase+Scan.mm`

---

## 4. Database Folder Structure

The Horos data directory (default: `~/Library/Application Support/Horos/Horos Data/`) contains:

```
Horos Data/
  Database.sql           -- SQLite persistent store (Core Data)
  DB_VERSION             -- Plain text file with model version string ("2.5")
  DATABASE.noindex/      -- DICOM file storage (numbered subfolders)
    10000/
      1.dcm
      2.dcm
      ...
      9999.dcm
    20000/
      10000.dcm
      10001.dcm
      ...
    ...
  INCOMING.noindex/      -- Staging area for files from DICOM listener
  DECOMPRESSION.noindex/ -- Temp workspace for decompression operations
  TEMP.noindex/          -- General temporary storage (cleaned on exit)
  NOT READABLE/          -- Files that failed DICOM parsing
  REPORTS/               -- Generated clinical reports
  DUMP/                  -- Archived/exported data
  ROIs/                  -- Region of Interest data
  PAGES/                 -- Report pages
  3DSTATE/               -- 3D viewer state snapshots
  CLUTs/                 -- Color lookup tables
  3DPRESETS/             -- 3D rendering presets
  HTML_TEMPLATES/        -- Report templates
```

### File Naming in DATABASE.noindex

- Files are named by a monotonically incrementing `_dataFileIndex` counter: `1.dcm`,
  `2.dcm`, etc.
- Files are distributed into numbered subfolders. `DefaultFolderSizeForDB` (default: 10,000)
  controls how many files per folder.
- Folder naming formula: `ceil(fileIndex / 10000) * 10000`. So files 0-9999 go in `10000/`,
  files 10000-19999 go in `20000/`, etc.
- The `.noindex` suffix on directories prevents Spotlight from indexing the raw DICOM files
  (Horos provides its own Spotlight importer for the database).
- The `uniquePathForNewDataFileWithExtension:` method generates paths, checking for file
  existence to avoid overwrites.

### Spotlight Importer

Horos ships a separate Spotlight importer (`DicomImporter/`) that indexes 21 DICOM metadata
fields (patient name/ID, study/series descriptions, modality, institution, dates, UIDs) for
macOS system-wide search integration.

**Source files**: `Horos/Sources/DicomDatabase.mm`, `DicomImporter/schema.xml`

---

## 5. Multiple Library Locations and Sources

Horos has a sophisticated multi-source architecture managed through a "Sources" sidebar panel.

### Source Types

| Type | Class | Description |
|------|-------|-------------|
| Default Local | `DefaultLocalDatabaseNodeIdentifier` | Built-in database at default location. Always present, cannot be removed. |
| Local Database | `LocalDatabaseNodeIdentifier` | User-configured additional database paths. Stored in `localDatabasePaths` user default. |
| Remote Database | `RemoteDatabaseNodeIdentifier` | OsiriX/Horos servers on the network. Configured in `OSIRIXSERVERS` user default. |
| DICOM Node | `DicomNodeIdentifier` | PACS destinations (send-only, no browsing). Configured in `SERVERS` user default. |
| Mounted Device | `MountedDatabaseNodeIdentifier` | External drives, USB, optical media. Auto-detected via `NSWorkspaceDidMountNotification`. |
| Bonjour Service | (discovered) | Auto-discovered remote databases and DICOM nodes via Bonjour/mDNS. |

### Switching Between Sources

Clicking a source in the sidebar triggers `setDatabaseFromSourceIdentifier:`, which:
- For local databases: creates a `DicomDatabase` instance pointing to that path.
- For remote databases: creates a `RemoteDicomDatabase` with network connection.
- For mounted volumes: returns the cached database instance (or shows "disk is being
  processed" if still scanning).

Only one database is active at a time. Switching between sources changes the entire browser
view.

### Mounted Volume Detection

When external media is mounted, `_analyzeVolumeAtPath:` checks for:
1. A `DICOMDIR` file (standard DICOM media format).
2. An existing Horos/OsiriX data folder.
3. If found, presents a dialog (`DiscMountedAskTheUserDialogController`) offering: **Copy**
   (import into local database), **Ignore**, or **Reference** (browse in place).

**Source files**: `Horos/Sources/BrowserController+Sources.m`,
`Horos/Sources/BrowserController+Sources.h`

---

## 6. Copy Files vs Reference In Place

### User Preference

The behavior is controlled by two `NSUserDefaults` keys:

- **`COPYDATABASE`** (boolean): Master toggle for whether to copy files at all.
  Default: `YES` (enabled).
- **`COPYDATABASEMODE`** (integer): When `COPYDATABASE` is enabled, which mode to use:

| Tag Value | Label in Preferences UI | Behavior |
|-----------|------------------------|----------|
| 0 | "Always" | Every imported file is copied into `DATABASE.noindex/`. |
| 2 | "If files aren't located on the HD" | Only copy files from external/removable media; files already on the main drive are referenced in place. |
| 3 | "Ask the user" | Each import presents a dialog: "Copy Files", "Copy Links", or "Cancel". |

(Tag value 1, originally "if on CD", was removed after the new CD/DVD import system was
introduced; if found in user defaults, `AppController.m` upgrades it to mode 2.)

Default value: `COPYDATABASEMODE = 3` (ask the user).

### When "Copy Links" Is Chosen

- The image's `storedInDatabaseFolder` is set to `NO`.
- The `pathString` stores the absolute path to the original file.
- The file is NOT duplicated; the database entry just points to it.
- **Risk**: If the user moves or deletes the original file, the database entry becomes a
  broken reference. Horos does not monitor external files for changes.

### When "Copy Files" Is Chosen

- The file is physically copied into `DATABASE.noindex/` with a new numeric filename.
- `storedInDatabaseFolder` is set to `YES`.
- `pathString` stores the relative numeric path.
- The original file is left untouched (no move, no delete).

### Delete Behavior

- **`DELETEFILELISTENER`** (boolean, default: `YES`): When enabled, files that arrive in
  `INCOMING.noindex/` are deleted after successful import. When disabled, unreadable files
  are moved to `NOT READABLE/` instead of being deleted.

### Copy Implementation

The actual file copy is handled in `BrowserController+Sources+Copy.m`:
- Local-to-local: `NSFileManager copyItemAtPath:` or `/bin/cp` (for read-only sources).
- Local-to-remote: `RemoteDicomDatabase uploadFilesAtPaths:`.
- Remote-to-local: Downloads cached files.
- Remote-to-remote: Initiates DICOM C-STORE SCU transfer.
- Indexing is batched: new files are added to the database index every 5 seconds during
  copy, plus a final sweep at completion.

**Source files**: `Horos/Sources/BrowserController.m`, `Horos/Sources/DefaultsOsiriX.m`,
`Horos/Sources/AppController.m`, `Horos/Sources/BrowserController+Sources+Copy.m`,
`Preference Panes/OSIDatabasePreferencePane/Base.lproj/OSIDatabasePreferencePanePref.xib`

---

## 7. Import User Experience

### Progress Reporting

- Import runs on a background `NSThread` with status and progress properties.
- Thread status is updated with messages like "Scanning directories...", "Copying X files...",
  "Indexing X files...".
- Progress is reported as a float 0.0 to 1.0 during file enumeration.
- Status updates are throttled to every 0.5 seconds to avoid excessive UI refreshes.
- Progress is set to -1 during disc ejection (indeterminate).

### Large Import Chunking

File lists larger than 20,000 items are split into chunks for processing. Each chunk creates
`DicomFile` objects, extracts metadata dictionaries, and adds entries to the database
independently. This prevents memory exhaustion on very large imports.

### Error Handling

| Error Type | Behavior |
|------------|----------|
| Invalid DICOM file | Moved to `NOT READABLE/` directory (or deleted if `DELETEFILELISTENER` is on) |
| DICOMDIR parse failure | Falls back to full recursive directory scan |
| ZIP extraction failure | Prompts user for password via `_requestZipPassword:` dialog |
| File copy failure | Exception caught, logged, import continues with remaining files |
| CD/DVD read error | DICOMDIR validated via external `Decompress` process; aborted if exit status != 0 |
| Thread cancellation | Checked in loops via `isCancelled` flag; propagated to child copy threads |

### Cancellation

Users can cancel an in-progress import. The system checks `thread.isCancelled` at loop
boundaries and propagates cancellation to any spawned child threads (e.g., copy operations).

### Batch Behavior

Multiple files and folders can be dropped simultaneously. The system processes everything in
one batch operation, recursively expanding directories. DICOMDIR files, if present, are used
to accelerate metadata extraction (avoiding individual file parsing).

**Source files**: `Horos/Sources/DicomDatabase.mm`, `Horos/Sources/DicomDatabase+Scan.mm`,
`Horos/Sources/BrowserController.m`

---

## 8. Library Index Persistence

### Core Data Stack

Horos uses **Core Data with SQLite** backing for its library index:

- **Model**: `OsiriXDB_DataModel.momd` (versioned Core Data model, current version `2.5`)
- **Persistent store**: `Database.sql` (SQLite) in the Horos data directory
- **Merge policy**: `NSMergeByPropertyStoreTrumpMergePolicy` (store wins on conflict)
- **Undo**: Disabled (no undo manager attached to the context)
- **Concurrency**: `NSConfinementConcurrencyType` (thread-confined contexts)

### Entity Model

```
DicomStudy (1)
  |-- studyInstanceUID (primary key, String)
  |-- patientUID (String, computed from patient ID/name/DOB based on preferences)
  |-- patientID, name, dateOfBirth, patientSex
  |-- studyName, date, modality, accessionNumber
  |-- numberOfImages, comment, comment2, comment3, comment4
  |-- lockedStudy (Boolean)
  |-- series (to-many -> DicomSeries, cascade delete)
  |-- albums (many-to-many -> DicomAlbum)

DicomSeries (many per Study)
  |-- seriesInstanceUID (String)
  |-- seriesDICOMUID (String)
  |-- name (seriesDescription), modality, id (seriesNumber)
  |-- numberOfImages, numberOfFrames
  |-- study (to-one -> DicomStudy)
  |-- images (to-many -> DicomImage, cascade delete)

DicomImage (many per Series)
  |-- SOPUID / compressedSopInstanceUID
  |-- pathString / pathNumber (file location)
  |-- storedInDatabaseFolder (Boolean)
  |-- instanceNumber, sliceLocation, frameID
  |-- storedHeight, storedWidth
  |-- importedFile (Boolean), generatedByOsiriX (Boolean)
  |-- series (to-one -> DicomSeries)

DicomAlbum
  |-- name, comment
  |-- studies (many-to-many -> DicomStudy)
  |-- Smart album predicates with date tokens: $LASTHOUR, $TODAY, $WEEK, $MONTH, $YEAR

LogEntry
  |-- message, type, timestamps
  |-- source/destination host info
```

### Persistence Mechanics

- **Save**: `[managedObjectContext save:]` wrapped in context lock/unlock. Updates
  `DATABASEVERSION` user default.
- **Version tracking**: Model version written to `DB_VERSION` file alongside the SQLite store.
- **Migration**: `NSMigratePersistentStoresAutomaticallyOption` and
  `NSInferMappingModelAutomaticallyOption` enable lightweight Core Data migration.
  Heavy migrations use `OsiriXDB_DataMapping.xcmappingmodel`.
- **Journal mode**: SQLite configured with `journal_mode: "delete"` (not WAL) for
  compatibility.
- **Corruption recovery**: If the persistent store fails to load, the user is prompted to
  delete the corrupted index file. A fresh database is created and `DATABASE.noindex/` is
  rescanned to rebuild the index.

### Thread Safety

- `_processFilesLock` (`NSRecursiveLock`): serializes all file addition operations.
- `_importFilesFromIncomingDirLock`: coordinates incoming directory imports.
- `databasesDictionaryLock`: protects the static registry of active database instances.
- `independentContext:` creates separate `NSManagedObjectContext` instances sharing the same
  persistent store coordinator, enabling background thread access with change merging via
  `NSManagedObjectContextDidSaveNotification`.

### INCOMING Directory Monitoring

Horos monitors `INCOMING.noindex/` for new files (typically arriving from DICOM network
listeners). The method `initiateImportFilesFromIncomingDirUnlessAlreadyImporting` is called
after DICOM network receives, WADO downloads, and other async file arrivals. It checks the
`_importFilesFromIncomingDirLock` before spawning an import thread. The
`maxNumberOfFilesForCheckIncoming` user default (default: 10,000) limits how many files are
processed per import cycle.

### Database Rebuild

The user can trigger a full rebuild from the File menu. This:
1. Rescans all files in `DATABASE.noindex/`.
2. Removes database entries whose files no longer exist on disk.
3. Adds any new files found that aren't in the database.
4. Regenerates `patientUID` values based on current preferences.

**Source files**: `Horos/Sources/DicomDatabase.mm`, `Horos/Sources/DicomDatabase.h`,
`Nitrogen/Sources/N2ManagedDatabase.mm`, `Horos/Models/OsiriXDB_DataModel.xcdatamodeld/`

---

## Key Takeaways for Our Design

1. **Dual-mode storage is the industry standard**: Horos tracks per-image whether the file
   was copied or referenced. This is essential for a library that handles both local files
   and removable media.

2. **Numeric file naming in subfolders**: Horos strips original filenames entirely, using a
   monotonic counter. This avoids filename collisions and path length issues, at the cost of
   human readability.

3. **UID-based deduplication**: Three-level matching (Study > Series > Image via DICOM UIDs)
   is the correct approach. SOPInstanceUID is the ultimate unique key per image.

4. **Core Data + SQLite is the proven pattern**: The index is a database, not the file
   system. Files can be rescanned to rebuild the index at any time. This separates concerns
   cleanly.

5. **The "ask the user" default is good UX**: Rather than silently copying (wasting disk) or
   silently linking (risking broken references), the default mode 3 lets the user choose per
   import.

6. **The `.noindex` suffix is a macOS convention** that prevents Spotlight from indexing
   directory contents. Horos ships its own Spotlight importer to expose DICOM metadata
   through the system search.

7. **INCOMING as a staging directory**: Decouples file arrival (network listener, WADO
   download) from database indexing. Files land in INCOMING, then get processed in batches.
   This is a clean producer-consumer pattern.

8. **Chunked processing for scale**: Splitting imports into 20,000-file chunks prevents
   memory exhaustion. Medical imaging datasets can be enormous.
