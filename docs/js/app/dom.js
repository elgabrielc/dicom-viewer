(() => {
    const app = window.DicomViewerApp || {};
    window.DicomViewerApp = app;

    const $ = (id) => document.getElementById(id);

    const dom = {
        $,
        libraryView: $('libraryView'),
        viewerView: $('viewerView'),
        folderZone: $('folderZone'),
        studiesTable: $('studiesTable'),
        studiesTableHead: document.querySelector('#studiesTable thead'),
        studiesBody: $('studiesBody'),
        emptyState: $('emptyState'),
        emptyStateHint: $('emptyStateHint'),
        studyCount: $('studyCount'),
        refreshLibraryBtn: $('refreshLibraryBtn'),
        libraryFolderConfig: $('libraryFolderConfig'),
        libraryFolderInput: $('libraryFolderInput'),
        saveLibraryFolderBtn: $('saveLibraryFolderBtn'),
        libraryFolderStatus: $('libraryFolderStatus'),
        libraryFolderMessage: $('libraryFolderMessage'),
        uploadProgress: $('uploadProgress'),
        progressText: $('progressText'),
        progressDetail: $('progressDetail'),
        progressFill: $('progressFill'),
        canvas: $('imageCanvas'),
        slider: $('sliceSlider'),
        sliceInfo: $('sliceInfo'),
        seriesList: $('seriesList'),
        metadataContent: $('metadataContent'),
        studyTitle: $('studyTitle'),
        imageLoading: $('imageLoading'),
        resetViewBtn: $('resetViewBtn'),
        wlDisplay: $('wlDisplay'),
        measurementCanvas: $('measurementCanvas'),
        calibrationWarning: $('calibrationWarning'),
        canvasContainer: document.querySelector('.canvas-container'),
        prevBtn: $('prevSlice'),
        nextBtn: $('nextSlice'),
        backBtn: $('backBtn'),
        loadSampleCtBtn: $('loadSampleCtBtn'),
        loadSampleMriBtn: $('loadSampleMriBtn'),
    };

    // Scripts load at the end of body in the current static layout, so canvases exist here.
    dom.ctx = dom.canvas.getContext('2d');
    dom.measureCtx = dom.measurementCanvas.getContext('2d');

    app.dom = dom;
})();
