/**
 * Import Pipeline -- copy-on-import workflow for desktop DICOM library.
 *
 * Walks source folders, parses DICOM metadata, deduplicates by destination
 * path existence, copies valid DICOM files into the managed library folder
 * ($APPDATA/library/), indexes them, and reports progress.
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */
(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { parseDicomMetadataDetailed } = app.dicom;

    // =====================================================================
    // CONSTANTS
    // =====================================================================

    const LIBRARY_SUBFOLDER = 'library';
    const MAX_SCAN_DEPTH = 20;
    const IMPORT_CONCURRENCY = 10;
    const PROGRESS_UPDATE_INTERVAL = 50;
    const MAX_UID_SEGMENT_LENGTH = 64;
    const UID_SANITIZE_PATTERN = /[^a-zA-Z0-9.]/g;
    const UNKNOWN_UID_PLACEHOLDER = 'unknown';

    // =====================================================================
    // HELPERS
    // =====================================================================

    /**
     * Minimal DICOM metadata plausibility check.
     * Duplicated from sources.js (private there) per contract.
     */
    function hasLikelyDicomMetadata(meta) {
        return !!(
            meta?.transferSyntax ||
            meta?.studyInstanceUid ||
            meta?.seriesInstanceUid ||
            meta?.sopClassUid ||
            meta?.sopInstanceUid
        );
    }

    /**
     * Sanitize a single UID segment for use as a directory or file name.
     * Replaces non-alphanumeric/non-dot characters with underscore and
     * truncates to MAX_UID_SEGMENT_LENGTH.
     */
    function sanitizeUidSegment(uid) {
        if (!uid) return UNKNOWN_UID_PLACEHOLDER;
        const sanitized = String(uid).replace(UID_SANITIZE_PATTERN, '_');
        return sanitized.slice(0, MAX_UID_SEGMENT_LENGTH) || UNKNOWN_UID_PLACEHOLDER;
    }

    /**
     * Extract the parent directory from a path (platform-aware separators).
     */
    function getParentDir(path) {
        const normalized = String(path || '').replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash > 0 ? normalized.slice(0, lastSlash) : normalized;
    }

    /**
     * Yield to the event loop so the UI stays responsive.
     */
    function yieldToEventLoop() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Throttled progress emitter. Only calls the callback on meaningful
     * boundaries to avoid flooding the UI.
     */
    function emitProgress(onProgress, stats, currentPath, force) {
        if (typeof onProgress !== 'function') return;

        const shouldEmit = force ||
            stats.processed === 1 ||
            stats.processed % PROGRESS_UPDATE_INTERVAL === 0 ||
            stats.processed === stats.discovered;

        if (!shouldEmit) return;

        try {
            onProgress({
                phase: stats.phase,
                discovered: stats.discovered,
                processed: stats.processed,
                copied: stats.copied,
                skipped: stats.skipped,
                invalid: stats.invalid,
                errors: stats.errors,
                collisions: stats.collisions,
                currentPath: currentPath || ''
            });
        } catch (error) {
            console.warn('Import pipeline progress callback failed:', error);
        }
    }

    // =====================================================================
    // CORE API
    // =====================================================================

    /**
     * Resolve the absolute path to the managed library folder under app data.
     * @returns {Promise<string>} Absolute path to library root.
     */
    async function getLibraryPath() {
        const appDataDir = await window.__TAURI__.path.appDataDir();
        // Build path with a simple join -- appDataDir already ends with separator
        // on some platforms, so normalize by stripping trailing separator first.
        const base = appDataDir.replace(/[\\/]+$/, '');
        return base + '/' + LIBRARY_SUBFOLDER;
    }

    /**
     * Ensure the managed library folder exists, creating it recursively if needed.
     * @returns {Promise<string>} Absolute path to library root.
     */
    async function ensureLibraryFolder() {
        const libraryPath = await getLibraryPath();
        await window.__TAURI__.fs.mkdir(libraryPath, { recursive: true });
        return libraryPath;
    }

    /**
     * Build a deterministic destination path for a DICOM file based on its UIDs.
     *
     * Layout: <libraryRoot>/<StudyUID>/<SeriesUID>/<SOPUID>.dcm
     *
     * @param {string} libraryRoot - Absolute path to the library folder.
     * @param {Object} meta - Parsed DICOM metadata with UID fields.
     * @returns {string} Destination file path.
     * @throws {Error} If SOPInstanceUID is empty or missing.
     */
    function buildDestinationPath(libraryRoot, meta) {
        const sopUid = meta?.sopInstanceUid;
        if (!sopUid) {
            throw new Error('SOPInstanceUID is required to build a destination path');
        }

        const studySegment = sanitizeUidSegment(meta.studyInstanceUid);
        const seriesSegment = sanitizeUidSegment(meta.seriesInstanceUid);
        const sopSegment = sanitizeUidSegment(sopUid);

        const root = String(libraryRoot).replace(/[\\/]+$/, '');
        return root + '/' + studySegment + '/' + seriesSegment + '/' + sopSegment + '.dcm';
    }

    /**
     * Import DICOM files from source paths into the managed library.
     *
     * Walks the given source directories, reads and parses each file, and
     * copies valid DICOM files into the library folder tree organized by UIDs.
     * Duplicate files (same destination path) are skipped; size mismatches
     * on an existing path are counted as collisions.
     *
     * @param {string[]} sourcePaths - Absolute paths to scan for DICOM files.
     * @param {Object} [options] - Import options.
     * @param {Function} [options.onProgress] - Progress callback.
     * @param {AbortSignal} [options.signal] - Abort signal for cancellation.
     * @returns {Promise<Object>} Import result summary.
     */
    async function importFromPaths(sourcePaths, options = {}) {
        const { onProgress = null, signal = null } = options;
        const startedAt = performance.now();

        const stats = {
            phase: 'preparing',
            discovered: 0,
            processed: 0,
            copied: 0,
            skipped: 0,
            invalid: 0,
            errors: 0,
            collisions: 0
        };

        const studies = {};

        // Step (a): ensure destination exists
        const libraryRoot = await ensureLibraryFolder();

        // Step (b): walk source paths via Tauri manifest command
        stats.phase = 'scanning';
        emitProgress(onProgress, stats, '', true);

        if (signal?.aborted) {
            throw new DOMException('Import aborted', 'AbortError');
        }

        const invoke = window.__TAURI__?.core?.invoke;
        if (typeof invoke !== 'function') {
            throw new Error('Tauri runtime is not available for import');
        }

        const paths = (Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths]).filter(Boolean);
        const manifestEntries = await invoke('read_scan_manifest', {
            roots: paths,
            maxDepth: MAX_SCAN_DEPTH
        });

        if (!Array.isArray(manifestEntries)) {
            throw new Error('read_scan_manifest returned an unexpected result');
        }

        // Normalize manifest entries to a flat list of file paths
        const filePaths = manifestEntries
            .map(entry => (typeof entry?.path === 'string' ? entry.path : ''))
            .filter(Boolean);

        stats.discovered = filePaths.length;
        stats.phase = 'importing';
        emitProgress(onProgress, stats, '', true);

        // Step (c): process files with bounded concurrency
        const fs = window.__TAURI__.fs;
        let fileIndex = 0;

        async function processNextFile() {
            while (fileIndex < filePaths.length) {
                // Grab the next file atomically
                const currentIndex = fileIndex++;
                const filePath = filePaths[currentIndex];

                // Check for abort before each file
                if (signal?.aborted) {
                    throw new DOMException('Import aborted', 'AbortError');
                }

                try {
                    await processOneFile(fs, libraryRoot, filePath, stats, studies);
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    stats.errors++;
                    console.warn('Import pipeline: file error:', filePath, error);
                }

                stats.processed++;
                emitProgress(onProgress, stats, filePath, false);

                // Yield periodically to keep UI responsive
                if (currentIndex % IMPORT_CONCURRENCY === 0) {
                    await yieldToEventLoop();
                }
            }
        }

        // Launch worker pool (up to IMPORT_CONCURRENCY parallel workers)
        const workerCount = Math.min(IMPORT_CONCURRENCY, filePaths.length);
        const workers = Array.from({ length: workerCount }, () => processNextFile());
        await Promise.all(workers);

        // Step (d): final progress and result
        stats.phase = 'complete';
        emitProgress(onProgress, stats, '', true);

        return {
            imported: stats.copied,
            skipped: stats.skipped,
            invalid: stats.invalid,
            errors: stats.errors,
            collisions: stats.collisions,
            studies,
            duration: performance.now() - startedAt
        };
    }

    /**
     * Process a single file: read, parse, deduplicate, and copy.
     */
    async function processOneFile(fs, libraryRoot, filePath, stats, studies) {
        // Read the entire file (we need the full buffer for copying anyway)
        const buffer = await fs.readFile(filePath);

        // Parse DICOM metadata from the buffer
        const result = await parseDicomMetadataDetailed(buffer);
        const meta = result?.meta;

        // Validate: is this actually a DICOM file with meaningful metadata?
        if (!meta || !hasLikelyDicomMetadata(meta)) {
            stats.invalid++;
            return;
        }

        // SOPInstanceUID is mandatory for deduplication
        if (!meta.sopInstanceUid) {
            stats.invalid++;
            return;
        }

        // Build the destination path
        const destPath = buildDestinationPath(libraryRoot, meta);

        // Check if destination already exists (deduplication)
        const destExists = await fs.exists(destPath);

        if (destExists) {
            // Compare sizes to distinguish true duplicate from UID collision
            try {
                const destStat = await fs.stat(destPath);
                const sourceSize = buffer.byteLength || buffer.length;
                const destSize = destStat?.size ?? destStat?.len ?? -1;

                if (sourceSize === destSize) {
                    stats.skipped++;
                } else {
                    stats.collisions++;
                }
            } catch (statError) {
                // If stat fails, treat as skipped (file exists but we cannot compare)
                console.warn('Import pipeline: stat failed for existing destination:', destPath, statError);
                stats.skipped++;
            }
            return;
        }

        // Create parent directories and write the file
        const parentDir = getParentDir(destPath);
        await fs.mkdir(parentDir, { recursive: true });
        await fs.writeFile(destPath, buffer);
        stats.copied++;

        // Track study-level information for the result
        const studyUid = meta.studyInstanceUid || UNKNOWN_UID_PLACEHOLDER;
        if (!studies[studyUid]) {
            studies[studyUid] = {
                studyInstanceUid: studyUid,
                patientName: meta.patientName || '',
                studyDate: meta.studyDate || '',
                studyDescription: meta.studyDescription || '',
                seriesCount: 0,
                instanceCount: 0,
                series: {}
            };
        }

        const study = studies[studyUid];
        const seriesUid = meta.seriesInstanceUid || UNKNOWN_UID_PLACEHOLDER;
        if (!study.series[seriesUid]) {
            study.series[seriesUid] = {
                seriesInstanceUid: seriesUid,
                seriesDescription: meta.seriesDescription || '',
                modality: meta.modality || '',
                instanceCount: 0
            };
            study.seriesCount++;
        }

        study.series[seriesUid].instanceCount++;
        study.instanceCount++;
    }

    // =====================================================================
    // REGISTRATION
    // =====================================================================

    app.importPipeline = {
        getLibraryPath,
        ensureLibraryFolder,
        buildDestinationPath,
        importFromPaths
    };
})();
