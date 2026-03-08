(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};

    /**
     * Least Recently Used cache backed by a Map.
     * JavaScript Maps iterate in insertion order, so deleting and
     * re-inserting a key on access moves it to the end (most recent).
     * Eviction removes from the front (least recent).
     */
    class LRUCache {
        constructor(maxSize) {
            this._maxSize = maxSize;
            this._map = new Map();
        }

        get(key) {
            if (!this._map.has(key)) return undefined;
            const value = this._map.get(key);
            this._map.delete(key);
            this._map.set(key, value);
            return value;
        }

        set(key, value) {
            if (this._map.has(key)) {
                this._map.delete(key);
            }
            this._map.set(key, value);
            while (this._map.size > this._maxSize) {
                const oldest = this._map.keys().next().value;
                this._map.delete(oldest);
            }
        }

        has(key) {
            return this._map.has(key);
        }

        clear() {
            this._map.clear();
        }
    }

    const SLICE_CACHE_MAX_ENTRIES = 100;

    /**
     * Global application state
     * @property {Object} studies - Map of studyInstanceUid -> study data
     * @property {Object|null} currentStudy - Currently viewed study
     * @property {Object|null} currentSeries - Currently viewed series
     * @property {number} currentSliceIndex - Index of currently displayed slice
     * @property {LRUCache} sliceCache - LRU cache of parsed DICOM datasets by slice index
     * @property {string} currentTool - Active tool ('wl', 'pan', 'zoom', or null)
     * @property {Object} viewTransform - Pan and zoom state
     * @property {Object} windowLevel - Current W/L override (null = use DICOM values)
     * @property {Object} baseWindowLevel - Original W/L values for reset
     */
    const state = {
        studies: {},
        currentStudy: null,
        currentSeries: null,
        currentSliceIndex: 0,
        sliceCache: new LRUCache(SLICE_CACHE_MAX_ENTRIES),
        libraryAbort: null,
        libraryAvailable: false,
        libraryFolder: '',
        libraryFolderResolved: '',
        libraryFolderSource: '',
        libraryConfigReachable: false,
        studySort: { column: 'date', direction: 'desc' },
        currentTool: 'wl',
        viewTransform: { panX: 0, panY: 0, zoom: 1 },
        windowLevel: { center: null, width: null },
        baseWindowLevel: { center: null, width: null },
        isDragging: false,
        dragStart: { x: 0, y: 0 },
        measurements: new Map(),
        activeMeasurement: null,
        pixelSpacing: null
    };

    app.state = state;
})();
