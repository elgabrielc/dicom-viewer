// Copyright (c) 2026 Divergent Health Technologies
//
// Shared Node-side helpers for desktop test files.
// These run in the Node/Playwright context, NOT inside page.evaluate().
// Browser-context copies of these functions must stay inlined in each
// page.addInitScript callback.

/**
 * Normalize a file path: convert backslashes to forward slashes,
 * collapse consecutive slashes, and strip trailing slashes.
 */
function normalizePath(input) {
    const text = String(input || '').replace(/\\/g, '/');
    if (!text) return '';
    const collapsed = text.replace(/\/+/g, '/');
    if (collapsed === '/') return '/';
    return collapsed.replace(/\/+$/g, '');
}

/**
 * Join path segments, normalizing separators and stripping
 * leading/trailing slashes from interior parts.
 */
function joinPaths(...parts) {
    const cleaned = parts
        .filter((part) => part !== null && part !== undefined && part !== '')
        .map((part, index) => {
            const value = String(part).replace(/\\/g, '/');
            if (index === 0) {
                return value.replace(/\/+$/g, '') || '/';
            }
            return value.replace(/^\/+/g, '').replace(/\/+$/g, '');
        })
        .filter(Boolean);

    if (!cleaned.length) return '';
    return normalizePath(cleaned.join('/'));
}

module.exports = { normalizePath, joinPaths };
