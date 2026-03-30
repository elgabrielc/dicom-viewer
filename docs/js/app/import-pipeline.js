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
    const IMPORT_HEADER_READ_SIZES = Object.freeze([
        64 * 1024,
        256 * 1024
    ]);
    const IMPORT_TRUNCATION_ERROR_PATTERNS = [
        'buffer overrun',
        'attempt to read past end of buffer',
        'missing required meta header attribute 0002,0010'
    ];

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

    function hasImportDestinationMetadata(meta) {
        return !!(
            meta?.studyInstanceUid &&
            meta?.seriesInstanceUid &&
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

    function normalizeBinaryResponse(bytes) {
        if (bytes instanceof Uint8Array) {
            return bytes;
        }
        if (bytes instanceof ArrayBuffer) {
            return new Uint8Array(bytes);
        }
        if (bytes?.buffer instanceof ArrayBuffer && typeof bytes.byteLength === 'number') {
            return new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength);
        }
        if (Array.isArray(bytes)) {
            return Uint8Array.from(bytes);
        }
        if (bytes && Object.prototype.hasOwnProperty.call(bytes, 'data')) {
            return normalizeBinaryResponse(bytes.data);
        }
        return null;
    }

    function getImportParseErrorMessage(error) {
        if (!error) return '';
        if (typeof error === 'string') return error;
        if (typeof error.message === 'string' && error.message) return error.message;
        if (typeof error.exception === 'string' && error.exception) return error.exception;
        return String(error);
    }

    function hasDicomPreamble(bytes) {
        return !!(
            bytes &&
            bytes.byteLength >= 132 &&
            bytes[128] === 0x44 &&
            bytes[129] === 0x49 &&
            bytes[130] === 0x43 &&
            bytes[131] === 0x4d
        );
    }

    function shouldExpandImportHeaderRead(parseResult, headerBytes, requestedBytes) {
        if (!headerBytes || headerBytes.byteLength < requestedBytes) return false;

        if (parseResult?.meta) {
            return hasLikelyDicomMetadata(parseResult.meta) && !hasImportDestinationMetadata(parseResult.meta);
        }

        if (hasDicomPreamble(headerBytes)) {
            return true;
        }

        const message = getImportParseErrorMessage(parseResult?.error).toLowerCase();
        return IMPORT_TRUNCATION_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
    }

    async function readImportHeader(path, maxBytes) {
        const invoke = window.__TAURI__?.core?.invoke;
        if (typeof invoke !== 'function') {
            return null;
        }

        try {
            const bytes = await invoke('read_scan_header', { path, maxBytes });
            return normalizeBinaryResponse(bytes);
        } catch {
            return null;
        }
    }

    async function readImportMetadata(fs, filePath) {
        for (let stageIndex = 0; stageIndex < IMPORT_HEADER_READ_SIZES.length; stageIndex += 1) {
            const requestedBytes = IMPORT_HEADER_READ_SIZES[stageIndex];
            const headerBytes = await readImportHeader(filePath, requestedBytes);
            if (!headerBytes) {
                break;
            }

            const headerResult = await parseDicomMetadataDetailed(headerBytes);
            if (headerResult?.meta) {
                if (
                    shouldExpandImportHeaderRead(headerResult, headerBytes, requestedBytes) &&
                    stageIndex < IMPORT_HEADER_READ_SIZES.length - 1
                ) {
                    continue;
                }
                return headerResult;
            }

            if (headerBytes.byteLength < requestedBytes) {
                return headerResult;
            }

            if (shouldExpandImportHeaderRead(headerResult, headerBytes, requestedBytes)) {
                if (stageIndex < IMPORT_HEADER_READ_SIZES.length - 1) {
                    continue;
                }
                break;
            }

            return headerResult;
        }

        const buffer = await fs.readFile(filePath);
        return parseDicomMetadataDetailed(buffer);
    }

    async function getImportSourceSize(fs, fileEntry) {
        const manifestSize = Number(fileEntry?.size);
        if (Number.isFinite(manifestSize) && manifestSize >= 0) {
            return manifestSize;
        }

        const stat = await fs.stat(fileEntry?.path || '');
        const statSize = Number(stat?.size ?? stat?.len);
        return Number.isFinite(statSize) ? statSize : -1;
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
        const fileEntries = manifestEntries
            .map((entry) => ({
                path: typeof entry?.path === 'string' ? entry.path : '',
                name: typeof entry?.name === 'string' && entry.name ? entry.name : '',
                rootPath: typeof entry?.rootPath === 'string'
                    ? entry.rootPath
                    : (typeof entry?.root_path === 'string' ? entry.root_path : ''),
                size: Number.isFinite(Number(entry?.size)) ? Number(entry.size) : null
            }))
            .filter((entry) => entry.path);

        stats.discovered = fileEntries.length;
        stats.phase = 'importing';
        emitProgress(onProgress, stats, '', true);

        // Step (c): process files with bounded concurrency
        const fs = window.__TAURI__.fs;
        let fileIndex = 0;
        // Track in-flight destinations to prevent concurrent workers from
        // racing on the same <Study>/<Series>/<SOP>.dcm path.
        const claimedDestinations = new Set();

        async function processNextFile() {
            while (fileIndex < fileEntries.length) {
                // Grab the next file atomically
                const currentIndex = fileIndex++;
                const fileEntry = fileEntries[currentIndex];
                const filePath = fileEntry.path;

                // Check for abort before each file
                if (signal?.aborted) {
                    throw new DOMException('Import aborted', 'AbortError');
                }

                try {
                    await processOneFile(fs, libraryRoot, fileEntry, stats, studies, claimedDestinations);
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
        const workerCount = Math.min(IMPORT_CONCURRENCY, fileEntries.length);
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
    async function processOneFile(fs, libraryRoot, fileEntry, stats, studies, claimedDestinations) {
        const filePath = fileEntry.path;
        const result = await readImportMetadata(fs, filePath);
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

        // Prevent concurrent workers from racing on the same destination
        if (claimedDestinations.has(destPath)) {
            stats.skipped++;
            return;
        }
        claimedDestinations.add(destPath);

        // Check if destination already exists (deduplication)
        const destExists = await fs.exists(destPath);

        if (destExists) {
            // Compare sizes to distinguish true duplicate from UID collision
            try {
                const destStat = await fs.stat(destPath);
                const sourceSize = await getImportSourceSize(fs, fileEntry);
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

        // Only pull the full file bytes across the bridge when we actually need to copy.
        const buffer = await fs.readFile(filePath);

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
