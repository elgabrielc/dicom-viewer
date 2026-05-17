// Copyright (c) 2026 Divergent Health Technologies
//
// Promotes the CHANGELOG.md "[Unreleased]" section into a versioned, dated
// release heading and opens a fresh, empty "[Unreleased]" section above it.
//
// Usage: node desktop/scripts/promote-changelog.mjs <version> <YYYY-MM-DD>
// Invoked by desktop/scripts/release.sh as part of cutting a release.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNRELEASED_HEADING = '## [Unreleased]';
const UNRELEASED_HEADING_PATTERN = /^## \[Unreleased\]$/gm;

// Promote the [Unreleased] section to a versioned release heading. Returns the
// rewritten changelog text. Throws if [Unreleased] is absent or has no content
// -- an empty section almost always means a forgotten entry, not a real release.
export function promoteChangelog(markdown, version, date) {
    if (!version) {
        throw new Error('promoteChangelog: version is required');
    }
    if (!date) {
        throw new Error('promoteChangelog: date is required');
    }

    const headings = markdown.match(UNRELEASED_HEADING_PATTERN) || [];
    if (headings.length === 0) {
        throw new Error(`CHANGELOG: "${UNRELEASED_HEADING}" section not found`);
    }
    if (headings.length !== 1) {
        throw new Error(`CHANGELOG: "${UNRELEASED_HEADING}" section must appear exactly once`);
    }

    const markerIndex = markdown.search(UNRELEASED_HEADING_PATTERN);
    const afterMarker = markdown.slice(markerIndex + UNRELEASED_HEADING.length);
    const nextHeadingOffset = afterMarker.search(/\n## \[/);
    const sectionBody = nextHeadingOffset === -1 ? afterMarker : afterMarker.slice(0, nextHeadingOffset);

    if (sectionBody.trim() === '') {
        throw new Error(`CHANGELOG: "${UNRELEASED_HEADING}" section is empty -- nothing to release`);
    }

    return markdown.replace(UNRELEASED_HEADING, `${UNRELEASED_HEADING}\n\n## [${version}] - ${date}`);
}

function main() {
    const [version, date] = process.argv.slice(2);
    if (!version || !date) {
        console.error('usage: promote-changelog.mjs <version> <YYYY-MM-DD>');
        process.exit(1);
    }

    // The script lives at <repo>/desktop/scripts/; CHANGELOG.md is at <repo>/.
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const changelogPath = join(repoRoot, 'CHANGELOG.md');

    try {
        const current = readFileSync(changelogPath, 'utf8');
        writeFileSync(changelogPath, promoteChangelog(current, version, date));
        console.log(`CHANGELOG: promoted [Unreleased] -> [${version}] - ${date}`);
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

// Run main() only when executed directly, not when imported by a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
