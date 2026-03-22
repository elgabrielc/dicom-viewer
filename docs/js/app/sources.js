(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { uploadProgress, progressFill, progressText, progressDetail } = app.dom;
    const {
        parseDicomMetadata,
        parseDicomMetadataDetailed,
        isRenderableImageMetadata
    } = app.dicom;
    const DESKTOP_MAX_SCAN_DEPTH = 20;
    const DEFAULT_SCAN_CONCURRENCY = 100;
    const DESKTOP_PATH_SCAN_CONCURRENCY = 10;
    const DESKTOP_PATH_QUEUE_HIGH_WATER_MARK = 512;
    const DESKTOP_PATH_QUEUE_LOW_WATER_MARK = 256;
    const DESKTOP_PATH_READ_ATTEMPTS = 3;
    const DESKTOP_PATH_READ_RETRY_DELAY_MS = 50;
    const DESKTOP_SCAN_HEADER_BYTES = 256 * 1024;
    const DESKTOP_SCAN_HEADER_READ_SIZES = Object.freeze([
        64 * 1024,
        DESKTOP_SCAN_HEADER_BYTES
    ]);
    const DESKTOP_SCAN_SKIP_EXTENSIONS = new Set([
        '.bmp',
        '.chm',
        '.config',
        '.css',
        '.dll',
        '.dylib',
        '.eot',
        '.exe',
        '.gif',
        '.h',
        '.htm',
        '.html',
        '.ico',
        '.icns',
        '.inf',
        '.ini',
        '.jar',
        '.jpeg',
        '.jpg',
        '.js',
        '.md',
        '.mht',
        '.ocx',
        '.pak',
        '.pdf',
        '.plist',
        '.png',
        '.properties',
        '.ttf',
        '.txt',
        '.xml',
        '.xz'
    ]);
    // These names recur in exported disc bundles and never represent study content.
    const DESKTOP_SCAN_SKIP_FILE_NAMES = new Set([
        '.ds_store',
        'dicomdir',
        'thumbs.db'
    ]);
    // These are viewer payload directories that show up alongside studies on burned/exported media.
    const DESKTOP_SCAN_SKIP_DIRECTORY_NAMES = new Set([
        '__macosx',
        'catapult',
        'ddv',
        'libraries',
        'reviewer'
    ]);
    const SCAN_PROGRESS_UPDATE_INTERVAL = 200;
    const SCAN_YIELD_INTERVAL_MS = 16;

    function updateScanProgress(processed, total, valid) {
        if (processed % SCAN_PROGRESS_UPDATE_INTERVAL !== 0 && processed !== total) return;

        const pct = Math.round((processed / total) * 100);
        progressFill.style.animation = 'none';
        progressFill.style.width = pct + '%';
        progressText.textContent = `Scanning... ${pct}%`;
        progressDetail.textContent = `${processed}/${total} files (${valid} viewable DICOM)`;
    }

    function showIndeterminateProgress(text, detail = '') {
        uploadProgress.style.display = 'flex';
        progressFill.style.width = '100%';
        progressFill.style.animation = 'progress-pulse 1.5s ease-in-out infinite';
        progressText.textContent = text;
        progressDetail.textContent = detail;
    }

    function hideProgressOverlay() {
        uploadProgress.style.display = 'none';
        progressFill.style.width = '0%';
        progressFill.style.animation = 'none';
    }

    // Resolve the map key for a series within a study. Uses bare UID unless a
    // collision is detected (same UID, different description) -- common with
    // X-ray stitching modalities. Only then does it switch to composite keys,
    // so conformant datasets keep their original bare-UID keys and existing
    // notes/measurements are preserved.
    function resolveSeriesKey(studyMap, bareUid, desc) {
        const existing = studyMap[bareUid];
        if (existing) {
            if (existing.seriesDescription === desc) return bareUid;
            // Collision: re-key the existing series to a composite key
            const oldKey = `${bareUid}|${existing.seriesDescription || ''}`;
            studyMap[oldKey] = existing;
            existing.seriesInstanceUid = oldKey;
            delete studyMap[bareUid];
            return `${bareUid}|${desc}`;
        }
        // Check if a collision was already detected for this UID
        const compositeKey = `${bareUid}|${desc}`;
        if (studyMap[compositeKey]) return compositeKey;
        const hasCollision = Object.keys(studyMap).some(k => k.startsWith(`${bareUid}|`));
        return hasCollision ? compositeKey : bareUid;
    }

    function addSliceToStudies(studies, meta, source) {
        const studyUid = meta.studyInstanceUid;
        const bareUid = meta.seriesInstanceUid || 'default';

        if (!studies[studyUid]) {
            studies[studyUid] = {
                ...meta,
                series: {},
                seriesCount: 0,
                imageCount: 0,
                comments: [],
                reports: []
            };
        }
        const seriesUid = resolveSeriesKey(
            studies[studyUid].series, bareUid, meta.seriesDescription || ''
        );
        if (!studies[studyUid].series[seriesUid]) {
            studies[studyUid].series[seriesUid] = {
                seriesInstanceUid: seriesUid,
                seriesDescription: meta.seriesDescription,
                seriesNumber: meta.seriesNumber,
                transferSyntax: meta.transferSyntax,
                slices: [],
                comments: [],
                seenSliceKeys: new Set()
            };
        }
        const series = studies[studyUid].series[seriesUid];
        for (const slice of expandFrameSlices(meta, source)) {
            const sliceKey = getSliceDedupKey(slice);
            if (sliceKey && series.seenSliceKeys.has(sliceKey)) {
                continue;
            }
            if (sliceKey) {
                series.seenSliceKeys.add(sliceKey);
            }
            series.slices.push(slice);
        }
    }

    function expandFrameSlices(meta, source) {
        const frameCount = Math.max(1, meta?.numberOfFrames || 1);
        return Array.from({ length: frameCount }, (_, frameIndex) => ({
            source,
            frameIndex,
            sopInstanceUid: meta.sopInstanceUid || '',
            instanceNumber: meta.instanceNumber,
            sliceLocation: meta.sliceLocation
        }));
    }

    function getSliceDedupKey(slice) {
        if (!slice?.sopInstanceUid) {
            return null;
        }
        return `${slice.sopInstanceUid}|${slice.frameIndex || 0}`;
    }

    function finalizeStudies(studies) {
        for (const study of Object.values(studies)) {
            let count = 0;
            for (const series of Object.values(study.series)) {
                series.slices.sort((a, b) =>
                    (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0) ||
                    (a.sliceLocation ?? 0) - (b.sliceLocation ?? 0) ||
                    (a.frameIndex ?? 0) - (b.frameIndex ?? 0)
                );
                count += series.slices.length;
                delete series.seenSliceKeys;
            }
            study.seriesCount = Object.keys(study.series).length;
            study.imageCount = count;
        }
        return studies;
    }

    function getSliceCacheKey(slice, fallbackKey = null) {
        const source = slice?.source;
        switch (source?.kind) {
            case 'path':
                return `path:${source.path}`;
            case 'api':
                return `api:${source.apiBase}|${source.studyId}|${source.seriesId}|${source.sliceIndex}`;
            case 'blob':
                return source.blob || fallbackKey;
            case 'handle':
                return source.handle || fallbackKey;
            default:
                return fallbackKey ?? source ?? null;
        }
    }

    function joinPathSegments(parent, child) {
        const separator = parent.includes('\\') ? '\\' : '/';
        return parent.endsWith(separator) ? `${parent}${child}` : `${parent}${separator}${child}`;
    }

    async function joinPath(parent, child) {
        const pathApi = window.__TAURI__?.path;
        if (pathApi?.join) {
            return pathApi.join(parent, child);
        }

        return joinPathSegments(parent, child);
    }

    async function normalizePath(path) {
        const pathApi = window.__TAURI__?.path;
        if (pathApi?.normalize) {
            try {
                return await pathApi.normalize(path);
            } catch (e) {
                console.warn('Failed to normalize desktop path:', path, e);
            }
        }
        return path;
    }

    function joinScanPath(parent, child) {
        // Desktop scan roots are normalized once up front, and readDir() only yields basenames.
        // Reusing the shared string join avoids hot-loop path IPC without introducing a second fallback shape.
        return joinPathSegments(parent, child);
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

    async function readDesktopScanHeader(path, maxBytes = DESKTOP_SCAN_HEADER_BYTES) {
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

    async function parseDesktopScanBuffer(buffer, stats) {
        const shouldTimeParse = typeof stats.parseMs === 'number';
        const parseStartedAt = shouldTimeParse ? performance.now() : 0;
        try {
            return await parseDicomMetadataDetailed(buffer);
        } finally {
            addDesktopScanTiming(stats, 'parseMs', shouldTimeParse ? performance.now() - parseStartedAt : 0);
        }
    }

    function addDesktopScanTiming(stats, key, deltaMs) {
        if (typeof stats[key] !== 'number' || !Number.isFinite(deltaMs)) return;
        stats[key] += deltaMs;
    }

    function incrementDesktopScanCounter(stats, key, delta = 1) {
        if (typeof stats[key] !== 'number') return;
        stats[key] += delta;
    }

    function getDesktopScanParseErrorMessage(error) {
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

    // These string matches come from the bundled dicomParser implementation:
    // - parseDicomDataSetExplicit(...) => "buffer overrun"
    // - readFixedString(...) => "attempt to read past end of buffer"
    // - parseDicom(...) => "missing required meta header attribute 0002,0010"
    // If dicomParser changes these messages, update this heuristic and its scan fallback tests together.
    const DESKTOP_SCAN_TRUNCATION_ERROR_PATTERNS = [
        'buffer overrun',
        'attempt to read past end of buffer',
        'missing required meta header attribute 0002,0010'
    ];

    function hasLikelyDicomMetadata(meta) {
        return !!(
            meta?.transferSyntax ||
            meta?.studyInstanceUid ||
            meta?.seriesInstanceUid ||
            meta?.sopClassUid ||
            meta?.sopInstanceUid
        );
    }

    function shouldExpandDesktopScanHeaderRead(parseResult, headerBytes, requestedBytes) {
        if (!headerBytes || headerBytes.byteLength < requestedBytes) return false;

        if (parseResult?.meta) {
            // Small staged reads can parse enough structure to look like DICOM without
            // reaching rows/cols or the pixel data tag yet. Keep growing the probe until
            // the metadata is actually sufficient for renderability checks.
            return hasLikelyDicomMetadata(parseResult.meta) && !isRenderableImageMetadata(parseResult.meta);
        }

        if (hasDicomPreamble(headerBytes)) {
            return true;
        }

        const message = getDesktopScanParseErrorMessage(parseResult?.error).toLowerCase();
        return DESKTOP_SCAN_TRUNCATION_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
    }

    async function readDesktopScanMetadata(source, stats) {
        const shouldTimeReads = typeof stats.readFileMs === 'number';
        for (let stageIndex = 0; stageIndex < DESKTOP_SCAN_HEADER_READ_SIZES.length; stageIndex += 1) {
            const requestedBytes = DESKTOP_SCAN_HEADER_READ_SIZES[stageIndex];
            const headerReadStartedAt = shouldTimeReads ? performance.now() : 0;
            const headerBytes = await readDesktopScanHeader(source.path, requestedBytes);
            const headerReadDeltaMs = shouldTimeReads ? performance.now() - headerReadStartedAt : 0;
            addDesktopScanTiming(stats, 'readFileMs', headerReadDeltaMs);
            addDesktopScanTiming(stats, 'headerReadMs', headerReadDeltaMs);

            if (!headerBytes) {
                break;
            }

            incrementDesktopScanCounter(stats, 'headerReadCount');
            const headerResult = await parseDesktopScanBuffer(headerBytes, stats);
            if (headerResult.meta) {
                incrementDesktopScanCounter(stats, 'headerHitCount');
                return headerResult.meta;
            }

            if (headerBytes.byteLength < requestedBytes) {
                incrementDesktopScanCounter(stats, 'headerShortCount');
                return headerResult.meta;
            }

            if (shouldExpandDesktopScanHeaderRead(headerResult, headerBytes, requestedBytes)) {
                if (stageIndex < DESKTOP_SCAN_HEADER_READ_SIZES.length - 1) {
                    continue;
                }
                incrementDesktopScanCounter(stats, 'headerFallbackCount');
                break;
            }

            incrementDesktopScanCounter(stats, 'headerRejectedCount');
            return headerResult.meta;
        }

        let buffer;
        const fullReadStartedAt = shouldTimeReads ? performance.now() : 0;
        try {
            buffer = await readSliceBuffer({ source }, 'scan');
        } finally {
            const fullReadDeltaMs = shouldTimeReads ? performance.now() - fullReadStartedAt : 0;
            addDesktopScanTiming(stats, 'readFileMs', fullReadDeltaMs);
            addDesktopScanTiming(stats, 'fullReadMs', fullReadDeltaMs);
        }

        const fullResult = await parseDesktopScanBuffer(buffer, stats);
        return fullResult.meta;
    }

    async function readDesktopScanManifest(paths, maxDepth) {
        const invoke = window.__TAURI__?.core?.invoke;
        if (typeof invoke !== 'function') {
            return null;
        }

        try {
            const entries = await invoke('read_scan_manifest', { roots: paths, maxDepth });
            if (!Array.isArray(entries)) {
                return null;
            }
            return entries
                .map((entry) => ({
                    path: typeof entry?.path === 'string' ? entry.path : '',
                    name: typeof entry?.name === 'string' ? entry.name : getPathName(entry?.path),
                    rootPath: typeof entry?.rootPath === 'string'
                        ? entry.rootPath
                        : (typeof entry?.root_path === 'string' ? entry.root_path : ''),
                    size: Number.isFinite(Number(entry?.size)) ? Number(entry.size) : null,
                    modifiedMs: Number.isFinite(Number(entry?.modifiedMs))
                        ? Number(entry.modifiedMs)
                        : (Number.isFinite(Number(entry?.modified_ms)) ? Number(entry.modified_ms) : null)
                }))
                .filter((entry) => entry.path);
        } catch (error) {
            console.warn('Desktop scan manifest unavailable, falling back to fs.readDir walk:', error);
            return null;
        }
    }

    async function loadDesktopScanCache(rootPaths) {
        const notesApi = window.NotesAPI;
        if (typeof notesApi?.loadDesktopScanCache !== 'function') {
            return new Map();
        }

        try {
            const rows = await notesApi.loadDesktopScanCache(rootPaths);
            const cache = new Map();
            for (const row of rows || []) {
                if (!row?.path) continue;
                let meta = null;
                if (row.renderable && typeof row.meta_json === 'string' && row.meta_json) {
                    try {
                        meta = JSON.parse(row.meta_json);
                    } catch (error) {
                        console.warn('Desktop scan cache entry contained invalid metadata JSON:', error);
                        continue;
                    }
                }
                cache.set(row.path, {
                    size: Number.isFinite(Number(row.size)) ? Number(row.size) : null,
                    modifiedMs: Number.isFinite(Number(row.modified_ms)) ? Number(row.modified_ms) : null,
                    renderable: !!row.renderable,
                    meta
                });
            }
            return cache;
        } catch (error) {
            console.warn('Desktop scan cache load failed:', error);
            return new Map();
        }
    }

    async function saveDesktopScanCacheEntries(entries) {
        const notesApi = window.NotesAPI;
        if (typeof notesApi?.saveDesktopScanCacheEntries !== 'function') {
            return;
        }

        try {
            await notesApi.saveDesktopScanCacheEntries(entries);
        } catch (error) {
            console.warn('Desktop scan cache save failed:', error);
        }
    }

    function getDesktopScanCacheHit(cacheByPath, fileEntry) {
        const path = fileEntry?.source?.path;
        if (!path || !cacheByPath?.size) {
            return null;
        }

        const cached = cacheByPath.get(path);
        if (!cached) {
            return null;
        }

        const size = Number.isFinite(Number(fileEntry.size)) ? Number(fileEntry.size) : null;
        const modifiedMs = Number.isFinite(Number(fileEntry.modifiedMs)) ? Number(fileEntry.modifiedMs) : null;
        if (cached.size !== size) {
            return null;
        }
        if (cached.modifiedMs !== modifiedMs) {
            return null;
        }
        return cached;
    }

    function createDesktopScanCacheEntry(fileEntry, meta, renderable) {
        if (
            fileEntry?.source?.kind !== 'path'
            || !fileEntry.source.path
            || !fileEntry.rootPath
            || !Number.isFinite(Number(fileEntry.size))
        ) {
            return null;
        }

        let metaJson = null;
        if (renderable && meta) {
            try {
                metaJson = JSON.stringify(meta);
            } catch (error) {
                console.warn('Failed to serialize desktop scan cache metadata:', error);
            }
        }

        return {
            path: fileEntry.source.path,
            rootPath: fileEntry.rootPath,
            size: Number(fileEntry.size),
            modifiedMs: Number.isFinite(Number(fileEntry.modifiedMs)) ? Number(fileEntry.modifiedMs) : null,
            renderable: !!renderable,
            metaJson
        };
    }

    function getPathName(path) {
        return path.split(/[\\/]/).pop() || path;
    }

    function getDesktopScanFileExtension(name) {
        const lastDot = String(name || '').lastIndexOf('.');
        if (lastDot <= 0) return '';
        return String(name).slice(lastDot).toLowerCase();
    }

    function isDesktopScanDicomDirFileName(name) {
        return String(name || '').toLowerCase() === 'dicomdir';
    }

    function shouldSkipDesktopScanPathEntry(name) {
        const normalizedName = String(name || '').toLowerCase();
        return (!isDesktopScanDicomDirFileName(normalizedName) && DESKTOP_SCAN_SKIP_FILE_NAMES.has(normalizedName)) ||
            DESKTOP_SCAN_SKIP_EXTENSIONS.has(getDesktopScanFileExtension(normalizedName));
    }

    function shouldSkipDesktopScanDirectory(name) {
        const normalizedName = String(name || '').toLowerCase();
        return normalizedName.endsWith('.app') ||
            DESKTOP_SCAN_SKIP_DIRECTORY_NAMES.has(normalizedName);
    }

    function createDesktopPathScanStats(captureTiming) {
        const stats = {
            discovered: 0,
            processed: 0,
            valid: 0
        };
        if (captureTiming) {
            Object.assign(stats, {
                readDirMs: 0,
                readFileMs: 0,
                headerReadMs: 0,
                fullReadMs: 0,
                parseMs: 0,
                finalizeMs: 0,
                headerReadCount: 0,
                headerHitCount: 0,
                headerShortCount: 0,
                headerFallbackCount: 0,
                headerRejectedCount: 0
            });
        }
        return stats;
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function createYieldController(intervalMs = SCAN_YIELD_INTERVAL_MS) {
        let lastYieldAt = performance.now();
        return async function yieldIfNeeded(force = false) {
            const now = performance.now();
            if (!force && (now - lastYieldAt) < intervalMs) {
                return;
            }
            lastYieldAt = now;
            await wait(0);
        };
    }

    function getScanConcurrency(files) {
        return files.some(({ source }) => source?.kind === 'path')
            ? DESKTOP_PATH_SCAN_CONCURRENCY
            : DEFAULT_SCAN_CONCURRENCY;
    }

    async function withRetries(task, options = {}) {
        const {
            attempts = 1,
            retryDelayMs = 0,
            onRetry = null
        } = options;

        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                return await task();
            } catch (error) {
                lastError = error;
                if (attempt >= attempts) break;

                if (typeof onRetry === 'function') {
                    onRetry(error, attempt + 1);
                }

                if (retryDelayMs > 0) {
                    await wait(retryDelayMs * attempt);
                }
            }
        }

        throw lastError;
    }

    function safeEmitDesktopPathProgress(onProgress, stats, options = {}) {
        if (typeof onProgress !== 'function') return;

        const { force = false, currentPath = '', complete = false } = options;
        const shouldEmit = force ||
            stats.discovered === 0 ||
            stats.processed === 1 ||
            stats.discovered % SCAN_PROGRESS_UPDATE_INTERVAL === 0 ||
            stats.processed % SCAN_PROGRESS_UPDATE_INTERVAL === 0 ||
            stats.processed === stats.discovered;

        if (!shouldEmit) return;

        try {
            onProgress({ ...stats, currentPath, complete });
        } catch (error) {
            console.warn('Desktop path scan progress callback failed:', error);
        }
    }

    async function getAllFileHandles(dirHandle) {
        const files = [];
        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === 'file') {
                files.push({ handle, name });
            } else if (handle.kind === 'directory') {
                files.push(...await getAllFileHandles(handle));
            }
        }
        return files;
    }

    async function processFiles(fileHandles) {
        const files = fileHandles.map(({ handle, name }) => ({
            name,
            source: { kind: 'handle', handle }
        }));
        return processFilesFromSources(files);
    }

    async function processFilesFromSources(files) {
        const studies = {};
        const total = files.length;
        let processed = 0;
        let valid = 0;

        const concurrency = getScanConcurrency(files);
        for (let i = 0; i < files.length; i += concurrency) {
            const batch = files.slice(i, i + concurrency);
            await Promise.all(batch.map(async ({ name, source }) => {
                try {
                    const buffer = await readSliceBuffer({ source }, 'scan');
                    const meta = await parseDicomMetadata(buffer);
                    if (!isRenderableImageMetadata(meta)) return;
                    valid++;
                    addSliceToStudies(studies, meta, source);
                } catch (e) {
                    console.warn(`Skipping unreadable DICOM file during scan: ${name}`, e);
                } finally {
                    processed++;
                    updateScanProgress(processed, total, valid);
                }
            }));
        }

        return finalizeStudies(studies);
    }

    async function processDesktopPathFile(fileEntry, studies, stats, onProgress, cacheUpdates = null) {
        const { name, source } = fileEntry;
        let meta = null;
        let renderable = false;
        let shouldCache = false;
        try {
            if (shouldSkipDesktopScanPathEntry(name)) {
                return;
            }
            meta = await readDesktopScanMetadata(source, stats);
            shouldCache = true;
            renderable = isRenderableImageMetadata(meta);
            if (!renderable) return;
            stats.valid++;
            addSliceToStudies(studies, meta, source);
        } catch (e) {
            console.warn(`Skipping unreadable DICOM file during scan: ${name}`, e);
        } finally {
            const cacheEntry = shouldCache ? createDesktopScanCacheEntry(fileEntry, meta, renderable) : null;
            if (cacheEntry && Array.isArray(cacheUpdates)) {
                cacheUpdates.push(cacheEntry);
            }
            stats.processed++;
            safeEmitDesktopPathProgress(onProgress, stats, { currentPath: source?.path || '' });
        }
    }

    async function processDesktopPathDicomDirFile(
        fileEntry,
        studies,
        indexedFilePaths,
        stats,
        onProgress,
        availablePaths = null
    ) {
        const sourcePath = fileEntry?.source?.path || '';
        const shouldTimeReads = typeof stats.readFileMs === 'number';
        let indexedCount = 0;
        try {
            const readStartedAt = shouldTimeReads ? performance.now() : 0;
            const bytes = await readSliceBuffer({ source: fileEntry.source }, 'scan');
            const readDeltaMs = shouldTimeReads ? performance.now() - readStartedAt : 0;
            addDesktopScanTiming(stats, 'readFileMs', readDeltaMs);
            addDesktopScanTiming(stats, 'fullReadMs', readDeltaMs);

            const parseStartedAt = shouldTimeReads ? performance.now() : 0;
            const result = await app.dicom.parseDicomDirectoryDetailed(bytes, sourcePath);
            if (shouldTimeReads) {
                addDesktopScanTiming(stats, 'parseMs', performance.now() - parseStartedAt);
            }

            if (result?.error) {
                console.warn(`Skipping unreadable DICOMDIR during scan: ${sourcePath}`, result.error);
                return;
            }

            for (const entry of result?.entries || []) {
                if (!entry?.meta || !entry?.source?.path) {
                    continue;
                }
                if (availablePaths instanceof Set && !availablePaths.has(entry.source.path)) {
                    continue;
                }
                indexedCount += 1;
                indexedFilePaths.add(entry.source.path);
                addSliceToStudies(studies, entry.meta, entry.source);
            }
            stats.valid += indexedCount;
        } catch (error) {
            console.warn(`Skipping unreadable DICOMDIR during scan: ${sourcePath}`, error);
        } finally {
            stats.processed += 1;
            safeEmitDesktopPathProgress(onProgress, stats, { currentPath: sourcePath });
        }
    }

    async function readSliceBuffer(slice, purpose = 'load') {
        const source = slice.source;

        switch (source?.kind) {
            case 'handle':
                return (await source.handle.getFile()).arrayBuffer();
            case 'blob':
                return source.blob.arrayBuffer();
            case 'api': {
                const resp = await fetch(
                    `${source.apiBase}/dicom/${encodeURIComponent(source.studyId)}/${encodeURIComponent(source.seriesId)}/${source.sliceIndex}`
                );
                if (!resp.ok) throw new Error(`Failed to ${purpose} slice: ${resp.status}`);
                return resp.arrayBuffer();
            }
            case 'path': {
                const bytes = await withRetries(
                    () => window.__TAURI__.fs.readFile(source.path),
                    {
                        attempts: DESKTOP_PATH_READ_ATTEMPTS,
                        retryDelayMs: DESKTOP_PATH_READ_RETRY_DELAY_MS,
                        onRetry: (error, nextAttempt) => {
                            console.warn(
                                `Retrying desktop file read (${nextAttempt}/${DESKTOP_PATH_READ_ATTEMPTS}) for ${source.path}:`,
                                error
                            );
                        }
                    }
                );
                return bytes;
            }
            default:
                throw new Error(`Unknown source kind: ${source?.kind}`);
        }
    }

    function normalizeStudiesPayload(payload, apiBase) {
        const studiesArray = Array.isArray(payload) ? payload : (payload.studies || []);
        const studies = {};

        for (const study of studiesArray) {
            const seriesMap = {};
            for (const series of (study.series || [])) {
                seriesMap[series.seriesInstanceUid] = {
                    seriesInstanceUid: series.seriesInstanceUid,
                    seriesDescription: series.seriesDescription,
                    seriesNumber: series.seriesNumber,
                    modality: series.modality,
                    comments: [],
                    slices: Array.from({ length: series.sliceCount }, (_, i) => ({
                        instanceNumber: i + 1,
                        sliceLocation: 0,
                        source: {
                            kind: 'api',
                            apiBase,
                            studyId: study.studyInstanceUid,
                            seriesId: series.seriesInstanceUid,
                            sliceIndex: i
                        }
                    }))
                };
            }

            studies[study.studyInstanceUid] = {
                patientName: study.patientName,
                studyDate: study.studyDate,
                studyDescription: study.studyDescription,
                studyInstanceUid: study.studyInstanceUid,
                modality: study.modality,
                seriesCount: study.seriesCount,
                imageCount: study.imageCount,
                comments: [],
                reports: [],
                series: seriesMap
            };
        }

        if (Array.isArray(payload)) {
            return { studies, available: true, folder: '' };
        }

        return {
            studies,
            available: !!payload.available,
            folder: payload.folder || ''
        };
    }

    async function loadStudiesFromApi(apiBase, options = {}) {
        const response = await fetch(`${apiBase}/studies`, options);
        if (!response.ok) throw new Error(`Failed to load studies: ${response.status}`);
        const payload = await response.json();
        return normalizeStudiesPayload(payload, apiBase);
    }

    async function loadDroppedStudies(items) {
        uploadProgress.style.display = 'flex';
        progressText.textContent = 'Reading folder...';
        progressDetail.textContent = '';
        progressFill.style.width = '0%';

        try {
            if (!items?.[0]?.getAsFileSystemHandle) {
                throw new Error('Please use Chrome or Edge for folder drop support');
            }

            const handle = await items[0].getAsFileSystemHandle();
            if (handle.kind !== 'directory') {
                throw new Error('Please drop a folder, not a file');
            }

            progressText.textContent = 'Finding files...';
            const fileHandles = await getAllFileHandles(handle);
            progressDetail.textContent = `Found ${fileHandles.length} files`;

            if (!fileHandles.length) {
                throw new Error('No files found');
            }

            return await processFiles(fileHandles);
        } finally {
            uploadProgress.style.display = 'none';
        }
    }

    async function resolveDesktopPathSource(fs, path, readError) {
        if (!fs?.stat) {
            return [{
                name: getPathName(path),
                source: { kind: 'path', path }
            }];
        }

        try {
            const info = await fs.stat(path);
            if (info?.isFile) {
                return [{
                    name: getPathName(path),
                    source: { kind: 'path', path }
                }];
            }

            if (info?.isDirectory) {
                throw new Error(`Failed to read directory: ${path}`);
            }
        } catch (statError) {
            if (statError?.message === `Failed to read directory: ${path}`) {
                throw statError;
            }
        }

        if (readError instanceof Error) {
            throw readError;
        }
        throw new Error(`Failed to access path: ${path}`);
    }

    async function collectPathSources(path, options = {}) {
        const fs = window.__TAURI__?.fs;
        if (!fs?.readDir) {
            throw new Error('Desktop file APIs unavailable');
        }

        const {
            depth = 0,
            maxDepth = DESKTOP_MAX_SCAN_DEPTH,
            visited = new Set()
        } = options;
        const normalizedPath = await normalizePath(path);

        if (visited.has(normalizedPath)) {
            console.warn('Skipping already-visited desktop scan path:', normalizedPath);
            return [];
        }
        visited.add(normalizedPath);

        let entries;
        try {
            entries = await fs.readDir(normalizedPath);
        } catch (readError) {
            return await resolveDesktopPathSource(fs, normalizedPath, readError);
        }

        const files = [];
        for (const entry of entries) {
            const entryPath = await joinPath(normalizedPath, entry.name);
            if (entry.isSymlink) {
                console.warn('Skipping symlink during desktop scan:', entryPath);
                continue;
            }

            if (entry.isDirectory) {
                if (shouldSkipDesktopScanDirectory(entry.name)) {
                    continue;
                }
                if (depth >= maxDepth) {
                    console.warn('Skipping path beyond desktop scan depth limit:', entryPath);
                    continue;
                }
                files.push(...await collectPathSources(entryPath, {
                    depth: depth + 1,
                    maxDepth,
                    visited
                }));
            } else if (entry.isFile) {
                if (shouldSkipDesktopScanPathEntry(entry.name)) {
                    continue;
                }
                files.push({
                    name: entry.name,
                    source: { kind: 'path', path: entryPath }
                });
            }
        }
        return files;
    }

    async function loadStudiesFromDesktopPaths(paths, options = {}) {
        const fs = window.__TAURI__?.fs;
        if (!fs?.readDir) {
            throw new Error('Desktop file APIs unavailable');
        }

        const {
            maxDepth = DESKTOP_MAX_SCAN_DEPTH,
            onProgress = null,
            captureTiming = false
        } = options;

        const normalizedPaths = [];
        for (const path of (Array.isArray(paths) ? paths : [paths]).filter(Boolean)) {
            normalizedPaths.push(await normalizePath(path));
        }

        const studies = {};
        const pendingFiles = [];
        const stats = createDesktopPathScanStats(captureTiming);
        const cacheUpdates = [];
        const visited = new Set();
        const queuedFilePaths = new Set();
        const stack = [];
        const yieldIfNeeded = createYieldController();
        let walkingComplete = false;
        let scanError = null;
        const queueWaiters = [];
        const queueDrainedWaiters = [];
        const indexedFilePaths = new Set();
        const manifestStartedAt = captureTiming ? performance.now() : 0;
        const manifestEntries = await readDesktopScanManifest(normalizedPaths, maxDepth);
        const manifestPathSet = manifestEntries
            ? new Set(manifestEntries.map((entry) => entry.path).filter(Boolean))
            : null;
        if (captureTiming && manifestEntries) {
            stats.readDirMs += performance.now() - manifestStartedAt;
        }
        const cacheByPath = manifestEntries ? await loadDesktopScanCache(normalizedPaths) : new Map();
        for (const path of normalizedPaths) {
            stack.push({ path, depth: 0, rootPath: path });
        }
        stack.reverse();

        function wakeQueuedWorkers() {
            while (queueWaiters.length) {
                queueWaiters.shift()();
            }
        }

        function wakeQueueDrainWaiters() {
            if (pendingFiles.length > DESKTOP_PATH_QUEUE_LOW_WATER_MARK) {
                return;
            }
            while (queueDrainedWaiters.length) {
                queueDrainedWaiters.shift()();
            }
        }

        function enqueuePendingFile(fileEntry, currentPath = '') {
            const filePath = fileEntry.source?.kind === 'path' ? fileEntry.source.path : '';
            if (filePath) {
                if (queuedFilePaths.has(filePath)) {
                    return false;
                }
                queuedFilePaths.add(filePath);
            }
            pendingFiles.push(fileEntry);
            stats.discovered++;
            safeEmitDesktopPathProgress(onProgress, stats, {
                currentPath: fileEntry.source?.path || currentPath
            });
            wakeQueuedWorkers();
            return true;
        }

        async function takePendingFile() {
            while (!pendingFiles.length) {
                if (walkingComplete || scanError) return null;
                await new Promise((resolve) => {
                    queueWaiters.push(resolve);
                });
            }

            const fileEntry = pendingFiles.shift();
            wakeQueueDrainWaiters();
            return fileEntry;
        }

        async function waitForQueueCapacity() {
            while (!scanError && pendingFiles.length >= DESKTOP_PATH_QUEUE_HIGH_WATER_MARK) {
                await new Promise((resolve) => {
                    queueDrainedWaiters.push(resolve);
                });
            }
        }

        async function workerLoop() {
            while (!scanError) {
                const fileEntry = await takePendingFile();
                if (!fileEntry) return;
                await processDesktopPathFile(fileEntry, studies, stats, onProgress, cacheUpdates);
                await yieldIfNeeded();
            }
        }

        const workers = Array.from(
            { length: DESKTOP_PATH_SCAN_CONCURRENCY },
            () => workerLoop()
        );

        safeEmitDesktopPathProgress(onProgress, stats, { force: true, complete: false });

        if (manifestEntries) {
            try {
                const dicomDirEntries = [];
                const otherEntries = [];
                for (const entry of manifestEntries) {
                    if (isDesktopScanDicomDirFileName(entry?.name)) {
                        dicomDirEntries.push(entry);
                    } else {
                        otherEntries.push(entry);
                    }
                }

                for (const entry of [...dicomDirEntries, ...otherEntries]) {
                    const fileEntry = {
                        name: entry.name,
                        source: { kind: 'path', path: entry.path },
                        rootPath: entry.rootPath || normalizedPaths[0] || '',
                        size: entry.size,
                        modifiedMs: entry.modifiedMs
                    };
                    const currentPath = fileEntry.source.path;
                    if (currentPath && queuedFilePaths.has(currentPath)) {
                        continue;
                    }

                    if (isDesktopScanDicomDirFileName(fileEntry.name)) {
                        if (currentPath) {
                            queuedFilePaths.add(currentPath);
                        }
                        stats.discovered++;
                        await processDesktopPathDicomDirFile(
                            fileEntry,
                            studies,
                            indexedFilePaths,
                            stats,
                            onProgress,
                            manifestPathSet
                        );
                        continue;
                    }

                    if (currentPath && indexedFilePaths.has(currentPath)) {
                        queuedFilePaths.add(currentPath);
                        stats.discovered++;
                        stats.processed++;
                        safeEmitDesktopPathProgress(onProgress, stats, { currentPath });
                        continue;
                    }

                    if (shouldSkipDesktopScanPathEntry(fileEntry.name)) {
                        if (currentPath) {
                            queuedFilePaths.add(currentPath);
                        }
                        stats.discovered++;
                        stats.processed++;
                        safeEmitDesktopPathProgress(onProgress, stats, { currentPath });
                        continue;
                    }

                    const cacheHit = getDesktopScanCacheHit(cacheByPath, fileEntry);
                    if (cacheHit) {
                        if (currentPath) {
                            queuedFilePaths.add(currentPath);
                        }
                        stats.discovered++;
                        if (cacheHit.renderable && cacheHit.meta) {
                            stats.valid++;
                            addSliceToStudies(studies, cacheHit.meta, fileEntry.source);
                        }
                        stats.processed++;
                        safeEmitDesktopPathProgress(onProgress, stats, { currentPath });
                        continue;
                    }

                    if (enqueuePendingFile(fileEntry, currentPath)) {
                        await waitForQueueCapacity();
                    }
                }
            } catch (error) {
                scanError = error;
                wakeQueuedWorkers();
                wakeQueueDrainWaiters();
                throw error;
            } finally {
                walkingComplete = true;
                wakeQueuedWorkers();
            }
        } else {
            try {
                while (stack.length) {
                    const current = stack.pop();
                    const currentPath = current.path;

                    if (visited.has(currentPath)) {
                        console.warn('Skipping already-visited desktop scan path:', currentPath);
                        continue;
                    }
                    visited.add(currentPath);

                    let entries;
                    const readDirStartedAt = captureTiming ? performance.now() : 0;
                    try {
                        entries = await fs.readDir(currentPath);
                    } catch (readError) {
                        if (captureTiming) {
                            stats.readDirMs += performance.now() - readDirStartedAt;
                        }
                        const fileEntries = await resolveDesktopPathSource(fs, currentPath, readError);
                        for (const fileEntry of fileEntries) {
                            if (shouldSkipDesktopScanPathEntry(fileEntry.name)) {
                                stats.discovered++;
                                stats.processed++;
                                safeEmitDesktopPathProgress(onProgress, stats, {
                                    currentPath: fileEntry.source?.path || currentPath
                                });
                                continue;
                            }
                            if (enqueuePendingFile({
                                ...fileEntry,
                                rootPath: current.rootPath
                            }, currentPath)) {
                                await waitForQueueCapacity();
                            }
                        }
                        await yieldIfNeeded();
                        continue;
                    }
                    if (captureTiming) {
                        stats.readDirMs += performance.now() - readDirStartedAt;
                    }

                    for (const entry of entries) {
                        if (!entry.isFile || !isDesktopScanDicomDirFileName(entry.name)) {
                            continue;
                        }
                        const entryPath = joinScanPath(currentPath, entry.name);
                        if (queuedFilePaths.has(entryPath)) {
                            continue;
                        }
                        queuedFilePaths.add(entryPath);
                        stats.discovered++;
                        await processDesktopPathDicomDirFile({
                            name: entry.name,
                            source: { kind: 'path', path: entryPath },
                            rootPath: current.rootPath
                        }, studies, indexedFilePaths, stats, onProgress);
                    }

                    for (const entry of entries) {
                        const entryPath = joinScanPath(currentPath, entry.name);
                        if (entry.isSymlink) {
                            console.warn('Skipping symlink during desktop scan:', entryPath);
                            continue;
                        }

                        if (entry.isDirectory) {
                            if (shouldSkipDesktopScanDirectory(entry.name)) {
                                continue;
                            }
                            if (current.depth >= maxDepth) {
                                console.warn('Skipping path beyond desktop scan depth limit:', entryPath);
                                continue;
                            }
                            stack.push({
                                path: entryPath,
                                depth: current.depth + 1,
                                rootPath: current.rootPath
                            });
                            continue;
                        }

                        if (!entry.isFile) continue;
                        if (isDesktopScanDicomDirFileName(entry.name)) {
                            continue;
                        }
                        if (indexedFilePaths.has(entryPath)) {
                            stats.discovered++;
                            stats.processed++;
                            safeEmitDesktopPathProgress(onProgress, stats, { currentPath: entryPath });
                            continue;
                        }
                        if (shouldSkipDesktopScanPathEntry(entry.name)) {
                            stats.discovered++;
                            stats.processed++;
                            safeEmitDesktopPathProgress(onProgress, stats, { currentPath: entryPath });
                            continue;
                        }

                        if (enqueuePendingFile({
                            name: entry.name,
                            source: { kind: 'path', path: entryPath },
                            rootPath: current.rootPath
                        }, entryPath)) {
                            await waitForQueueCapacity();
                        }
                    }

                    await yieldIfNeeded();
                }
            } catch (error) {
                scanError = error;
                wakeQueuedWorkers();
                wakeQueueDrainWaiters();
                throw error;
            } finally {
                walkingComplete = true;
                wakeQueuedWorkers();
            }
        }

        await Promise.all(workers);
        if (scanError) {
            throw scanError;
        }

        if (cacheUpdates.length) {
            await saveDesktopScanCacheEntries(cacheUpdates);
        }

        const finalizeStartedAt = captureTiming ? performance.now() : 0;
        const finalizedStudies = finalizeStudies(studies);
        if (captureTiming) {
            stats.finalizeMs += performance.now() - finalizeStartedAt;
        }
        safeEmitDesktopPathProgress(onProgress, stats, { force: true, complete: true });
        return finalizedStudies;
    }

    async function loadDroppedPaths(paths) {
        let lastProgress = { discovered: 0, processed: 0, valid: 0 };

        try {
            showIndeterminateProgress('Scanning desktop folder...', '0 files processed (0 viewable DICOM)');
            const studies = await loadStudiesFromDesktopPaths(paths, {
                onProgress: (stats) => {
                    lastProgress = stats;
                    showIndeterminateProgress(
                        'Scanning desktop folder...',
                        `${stats.processed}/${stats.discovered} files processed (${stats.valid} viewable DICOM)`
                    );
                }
            });

            if (!lastProgress.discovered) {
                throw new Error('No files found');
            }

            return studies;
        } finally {
            hideProgressOverlay();
        }
    }

    async function loadSampleStudies(samplePath, button, buttonLabel) {
        button.disabled = true;
        button.textContent = 'Loading...';
        uploadProgress.style.display = 'flex';
        progressText.textContent = 'Loading sample scan...';
        progressDetail.textContent = '';
        progressFill.style.width = '0%';

        try {
            const manifestRes = await fetch(`${samplePath}/manifest.json`);
            const fileNames = await manifestRes.json();

            progressText.textContent = 'Downloading DICOM files...';
            progressDetail.textContent = `0/${fileNames.length} files`;

            const filePromises = fileNames.map(async (name, i) => {
                const res = await fetch(`${samplePath}/${name}`);
                const blob = await res.blob();
                if ((i + 1) % 5 === 0 || i === fileNames.length - 1) {
                    const pct = Math.round(((i + 1) / fileNames.length) * 50);
                    progressFill.style.width = `${pct}%`;
                    progressDetail.textContent = `${i + 1}/${fileNames.length} files`;
                }
                return { name, blob };
            });

            const files = await Promise.all(filePromises);
            progressText.textContent = 'Processing DICOM files...';
            progressFill.style.width = '50%';

            const studies = {};
            let processed = 0;

            for (const { blob } of files) {
                const meta = await parseDicomMetadata(blob);
                processed++;

                const pct = 50 + Math.round((processed / files.length) * 50);
                progressFill.style.width = `${pct}%`;
                progressDetail.textContent = `Processing ${processed}/${files.length}`;

                if (!isRenderableImageMetadata(meta)) continue;

                addSliceToStudies(studies, meta, { kind: 'blob', blob });
            }

            return finalizeStudies(studies);
        } finally {
            hideProgressOverlay();
            button.textContent = buttonLabel;
            button.disabled = false;
        }
    }

    app.sources = {
        collectPathSources,
        getAllFileHandles,
        isRenderableImageMetadata,
        loadDroppedStudies,
        loadDroppedPaths,
        loadStudiesFromDesktopPaths,
        loadSampleStudies,
        processFiles,
        processFilesFromSources,
        readSliceBuffer,
        normalizeStudiesPayload,
        loadStudiesFromApi,
        expandFrameSlices,
        getSliceDedupKey,
        getSliceCacheKey
    };
})();
