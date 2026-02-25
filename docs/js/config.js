/**
 * DICOM Viewer Configuration
 *
 * Centralized deployment mode detection and feature flags.
 * This module detects the deployment environment and exposes
 * appropriate feature flags for each mode.
 *
 * Deployment Modes:
 * - demo: Public showcase on GitHub Pages (stateless)
 * - preview: PR preview on Vercel (stateless)
 * - cloud: Future hosted platform (app.divergent.health)
 * - personal: Local development or self-hosted (full features)
 *
 * Copyright (c) 2026 Divergent Health Technologies
 */

const CONFIG = {
    /**
     * Detect deployment mode based on hostname
     * @returns {'demo' | 'preview' | 'cloud' | 'personal'}
     */
    get deploymentMode() {
        const hostname = window.location.hostname;

        // GitHub Pages - public demo
        if (hostname.endsWith('github.io')) {
            return 'demo';
        }

        // Vercel preview deployments
        if (hostname.endsWith('vercel.app')) {
            return 'preview';
        }

        // Future cloud platform
        if (hostname.includes('divergent.health') && !hostname.includes('localhost')) {
            return 'cloud';
        }

        // Local development or self-hosted
        return 'personal';
    },

    /**
     * Feature flags based on deployment mode
     * @returns {Object} Feature flag configuration
     */
    get features() {
        const mode = this.deploymentMode;
        return {
            // Notes persistence (localStorage)
            // Enabled everywhere; localStorage on demo/preview, server on personal/cloud
            notesPersistence: true,

            // Server-side notes API available (Flask backend)
            // Only when running with the Flask server or cloud platform
            notesServer: mode === 'personal' || mode === 'cloud',

            // Cloud sync (future feature)
            // Only available on the cloud platform
            cloudSync: mode === 'cloud',

            // User accounts (future feature)
            // Only available on the cloud platform
            userAccounts: mode === 'cloud',

            // Sample data buttons
            // Available everywhere - useful for demos and testing
            sampleData: true,

            // Test mode API
            // Only works with Flask backend (localhost)
            testMode: mode === 'personal',

            // Auto-load persistent local library from backend API
            // Only in local/self-hosted personal mode
            libraryAutoLoad: mode === 'personal',

            // Analytics (future feature)
            // Only on cloud platform
            analytics: mode === 'cloud',
        };
    },

    /**
     * Check if notes should persist
     * Always true; storage backend depends on deployment mode
     * @returns {boolean}
     */
    shouldPersistNotes() {
        return this.features.notesPersistence;
    },

    /**
     * Check if running on the cloud platform
     * @returns {boolean}
     */
    isCloudPlatform() {
        return this.deploymentMode === 'cloud';
    },

    /**
     * Check if running in demo mode (GitHub Pages)
     * @returns {boolean}
     */
    isDemo() {
        return this.deploymentMode === 'demo';
    },

    /**
     * Check if running in a preview environment (Vercel)
     * @returns {boolean}
     */
    isPreview() {
        return this.deploymentMode === 'preview';
    },

    /**
     * Check if running locally or self-hosted
     * @returns {boolean}
     */
    isPersonal() {
        return this.deploymentMode === 'personal';
    },

    /**
     * Get human-readable deployment mode name
     * @returns {string}
     */
    getModeName() {
        const names = {
            demo: 'Demo',
            preview: 'Preview',
            cloud: 'Cloud',
            personal: 'Personal',
        };
        return names[this.deploymentMode] || 'Unknown';
    }
};

// Freeze to prevent modification
Object.freeze(CONFIG);

// Make available globally if not using modules
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
