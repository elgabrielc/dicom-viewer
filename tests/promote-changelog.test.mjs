// Copyright (c) 2026 Divergent Health Technologies

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { promoteChangelog, writeFileAtomically } from '../desktop/scripts/promote-changelog.mjs';

const SAMPLE = `# Changelog

## [Unreleased]

### Fixed
- A real bug fix

## [2026-04-10]

### Added
- An older feature
`;

test('promotes [Unreleased] to a versioned, dated heading', () => {
    const result = promoteChangelog(SAMPLE, '0.4.1', '2026-05-17');
    assert.match(result, /## \[0\.4\.1\] - 2026-05-17/);
});

test('moves existing entries under the new version heading', () => {
    const result = promoteChangelog(SAMPLE, '0.4.1', '2026-05-17');
    const versionIdx = result.indexOf('## [0.4.1] - 2026-05-17');
    const bugIdx = result.indexOf('- A real bug fix');
    const olderIdx = result.indexOf('## [2026-04-10]');
    assert.ok(versionIdx < bugIdx, 'entry sits under the new version heading');
    assert.ok(bugIdx < olderIdx, 'entry stays above the older section');
});

test('opens a fresh, empty [Unreleased] above the new version', () => {
    const result = promoteChangelog(SAMPLE, '0.4.1', '2026-05-17');
    const unreleasedIdx = result.indexOf('## [Unreleased]');
    const versionIdx = result.indexOf('## [0.4.1] - 2026-05-17');
    assert.notEqual(unreleasedIdx, -1, '[Unreleased] is still present');
    assert.ok(unreleasedIdx < versionIdx, '[Unreleased] sits above the version');
    const between = result.slice(unreleasedIdx + '## [Unreleased]'.length, versionIdx);
    assert.equal(between.trim(), '', '[Unreleased] is empty after promotion');
});

test('leaves older sections untouched', () => {
    const result = promoteChangelog(SAMPLE, '0.4.1', '2026-05-17');
    assert.match(result, /## \[2026-04-10\]\n\n### Added\n- An older feature/);
});

test('throws when the [Unreleased] section is missing', () => {
    const noUnreleased = '# Changelog\n\n## [2026-04-10]\n\n### Added\n- x\n';
    assert.throws(() => promoteChangelog(noUnreleased, '0.4.1', '2026-05-17'), /not found/);
});

test('throws when multiple [Unreleased] headings are present', () => {
    const duplicate = `# Changelog

## [Unreleased]

### Fixed
- first entry

## [Unreleased]

### Added
- second entry
`;
    assert.throws(() => promoteChangelog(duplicate, '0.4.1', '2026-05-17'), /exactly once/);
});

test('throws when the [Unreleased] section is empty', () => {
    const empty = '# Changelog\n\n## [Unreleased]\n\n## [2026-04-10]\n\n### Added\n- x\n';
    assert.throws(() => promoteChangelog(empty, '0.4.1', '2026-05-17'), /empty/);
});

test('throws when [Unreleased] is empty and is the last section', () => {
    const empty = '# Changelog\n\n## [Unreleased]\n';
    assert.throws(() => promoteChangelog(empty, '0.4.1', '2026-05-17'), /empty/);
});

test('promotes when [Unreleased] is the last section with content', () => {
    const lastWithContent = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- last-section fix\n';
    const result = promoteChangelog(lastWithContent, '0.4.1', '2026-05-17');
    assert.match(result, /## \[0\.4\.1\] - 2026-05-17/);
    assert.match(result, /- last-section fix/);
});

test('throws when version or date is missing', () => {
    assert.throws(() => promoteChangelog(SAMPLE, '', '2026-05-17'), /version is required/);
    assert.throws(() => promoteChangelog(SAMPLE, '0.4.1', ''), /date is required/);
});

test('writes changelog updates through a same-directory temporary file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'promote-changelog-'));
    try {
        const changelogPath = join(dir, 'CHANGELOG.md');
        writeFileSync(changelogPath, 'old\n');

        writeFileAtomically(changelogPath, 'new\n');

        assert.equal(readFileSync(changelogPath, 'utf8'), 'new\n');
        assert.deepEqual(readdirSync(dir), ['CHANGELOG.md']);
    } finally {
        rmSync(dir, { force: true, recursive: true });
    }
});
