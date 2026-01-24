/**
 * DICOM Viewer JavaScript - Server-Side Rendering Version
 * ========================================================
 *
 * This is the JavaScript for the ALTERNATIVE server-side rendering viewer
 * (templates/viewer.html). The primary viewer uses index.html with client-side
 * processing.
 *
 * This class fetches rendered PNG images from the Flask server's API:
 *   - /api/series/<id>/info - Get series metadata
 *   - /api/series/<id>/slice/<n> - Get rendered slice image
 *   - /api/series/<id>/slice/<n>/metadata - Get slice metadata
 *
 * Use Case:
 *   When DICOM files are uploaded to the server and you want the server
 *   to handle rendering (useful for Firefox/Safari which lack File System Access API)
 *
 * See index.html for the primary client-side viewer with compression support.
 */

class DicomViewer {
    constructor(studyId) {
        this.studyId = studyId;
        this.currentSeries = null;
        this.currentSlice = 0;
        this.totalSlices = 0;
        this.imageCache = new Map();

        // DOM elements
        this.canvas = document.getElementById('imageCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.slider = document.getElementById('sliceSlider');
        this.sliceInfo = document.getElementById('sliceInfo');
        this.seriesList = document.getElementById('seriesList');
        this.metadataContent = document.getElementById('metadataContent');
        this.studyTitle = document.getElementById('studyTitle');
        this.imageLoading = document.getElementById('imageLoading');
        this.prevBtn = document.getElementById('prevSlice');
        this.nextBtn = document.getElementById('nextSlice');

        this.init();
    }

    async init() {
        await this.loadStudy();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Slider change
        this.slider.addEventListener('input', () => {
            this.currentSlice = parseInt(this.slider.value);
            this.loadSlice(this.currentSlice);
        });

        // Previous/Next buttons
        this.prevBtn.addEventListener('click', () => this.prevSlice());
        this.nextBtn.addEventListener('click', () => this.nextSlice());

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.prevSlice();
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                this.nextSlice();
            }
        });

        // Mouse wheel navigation on canvas
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY > 0) {
                this.nextSlice();
            } else {
                this.prevSlice();
            }
        });
    }

    async loadStudy() {
        try {
            const response = await fetch(`/api/study/${this.studyId}`);
            if (!response.ok) {
                throw new Error('Study not found');
            }

            const study = await response.json();

            // Update title
            this.studyTitle.textContent = `${study.patient_name} - ${study.study_description || 'Study'}`;

            // Render series list
            this.renderSeriesList(study.series);

            // Auto-select first series
            if (study.series.length > 0) {
                this.selectSeries(study.series[0].series_id);
            }
        } catch (error) {
            console.error('Error loading study:', error);
            this.studyTitle.textContent = 'Error loading study';
            this.seriesList.innerHTML = '<p class="empty">Failed to load study</p>';
        }
    }

    renderSeriesList(series) {
        if (series.length === 0) {
            this.seriesList.innerHTML = '<p class="empty">No series found</p>';
            return;
        }

        this.seriesList.innerHTML = series.map(s => `
            <div class="series-item" data-series-id="${s.series_id}">
                <div class="series-name">${s.series_description || `Series ${s.series_number || '?'}`}</div>
                <div class="series-info">${s.slice_count} slices - ${s.modality}</div>
            </div>
        `).join('');

        // Add click handlers
        this.seriesList.querySelectorAll('.series-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectSeries(item.dataset.seriesId);
            });
        });
    }

    async selectSeries(seriesId) {
        // Update active state
        this.seriesList.querySelectorAll('.series-item').forEach(item => {
            item.classList.toggle('active', item.dataset.seriesId === seriesId);
        });

        this.currentSeries = seriesId;
        this.currentSlice = 0;
        this.imageCache.clear();

        // Get series info
        try {
            const response = await fetch(`/api/series/${seriesId}/info`);
            const info = await response.json();

            this.totalSlices = info.slice_count;

            // Update slider
            this.slider.max = Math.max(0, this.totalSlices - 1);
            this.slider.value = 0;

            // Load first slice
            await this.loadSlice(0);

            // Preload nearby slices
            this.preloadSlices();
        } catch (error) {
            console.error('Error loading series:', error);
        }
    }

    async loadSlice(sliceNum) {
        if (!this.currentSeries) return;

        this.showLoading(true);
        this.updateSliceInfo();

        try {
            // Load image
            const imageUrl = `/api/series/${this.currentSeries}/slice/${sliceNum}`;

            // Check cache first
            if (this.imageCache.has(sliceNum)) {
                this.displayImage(this.imageCache.get(sliceNum));
            } else {
                const img = new Image();
                img.onload = () => {
                    this.imageCache.set(sliceNum, img);
                    if (this.currentSlice === sliceNum) {
                        this.displayImage(img);
                    }
                };
                img.onerror = () => {
                    console.error('Error loading image');
                    this.showLoading(false);
                };
                img.src = imageUrl;
            }

            // Load metadata
            await this.loadSliceMetadata(sliceNum);
        } catch (error) {
            console.error('Error loading slice:', error);
            this.showLoading(false);
        }
    }

    displayImage(img) {
        // Set canvas size to match image
        this.canvas.width = img.width;
        this.canvas.height = img.height;

        // Draw image
        this.ctx.drawImage(img, 0, 0);

        this.showLoading(false);
    }

    async loadSliceMetadata(sliceNum) {
        try {
            const response = await fetch(`/api/series/${this.currentSeries}/slice/${sliceNum}/metadata`);
            const metadata = await response.json();

            this.renderMetadata(metadata);
        } catch (error) {
            console.error('Error loading metadata:', error);
        }
    }

    renderMetadata(metadata) {
        const items = [
            { label: 'Slice', value: `${metadata.slice_index + 1} / ${metadata.total_slices}` },
            { label: 'Instance Number', value: metadata.instance_number || '-' },
            { label: 'Slice Location', value: metadata.slice_location ? `${metadata.slice_location.toFixed(2)} mm` : '-' },
            { label: 'Slice Thickness', value: metadata.slice_thickness ? `${metadata.slice_thickness} mm` : '-' },
            { label: 'Image Size', value: `${metadata.columns} x ${metadata.rows}` },
            { label: 'Window Center', value: metadata.window_center },
            { label: 'Window Width', value: metadata.window_width }
        ];

        this.metadataContent.innerHTML = items.map(item => `
            <div class="metadata-item">
                <div class="label">${item.label}</div>
                <div class="value">${item.value}</div>
            </div>
        `).join('');
    }

    updateSliceInfo() {
        this.sliceInfo.textContent = `${this.currentSlice + 1} / ${this.totalSlices}`;
        this.slider.value = this.currentSlice;

        // Update button states
        this.prevBtn.disabled = this.currentSlice <= 0;
        this.nextBtn.disabled = this.currentSlice >= this.totalSlices - 1;
    }

    prevSlice() {
        if (this.currentSlice > 0) {
            this.currentSlice--;
            this.loadSlice(this.currentSlice);
            this.preloadSlices();
        }
    }

    nextSlice() {
        if (this.currentSlice < this.totalSlices - 1) {
            this.currentSlice++;
            this.loadSlice(this.currentSlice);
            this.preloadSlices();
        }
    }

    preloadSlices() {
        // Preload 5 slices ahead and behind
        const preloadRange = 5;
        for (let i = -preloadRange; i <= preloadRange; i++) {
            const sliceNum = this.currentSlice + i;
            if (sliceNum >= 0 && sliceNum < this.totalSlices && !this.imageCache.has(sliceNum)) {
                const img = new Image();
                img.onload = () => {
                    this.imageCache.set(sliceNum, img);
                };
                img.src = `/api/series/${this.currentSeries}/slice/${sliceNum}`;
            }
        }
    }

    showLoading(show) {
        this.imageLoading.style.display = show ? 'block' : 'none';
    }
}

// Initialize viewer when page loads
document.addEventListener('DOMContentLoaded', () => {
    if (typeof studyId !== 'undefined') {
        new DicomViewer(studyId);
    }
});
