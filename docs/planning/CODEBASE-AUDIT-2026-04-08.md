# Codebase Audit -- 2026-04-08

Three independent audits run against `origin/main` at commit `HEAD`:
- **Hardener**: simplification, duplication, dead code, reliability
- **Security Auditor**: OWASP, HIPAA, Tauri sandbox, auth, data protection
- **Code Reviewer**: correctness bugs, race conditions, architectural issues

Findings are deduplicated and merged below. Each finding is tagged with its source(s).

---

## HIGH

### 1. X-Test-Mode header bypasses all auth in production [Security]

`server/security.py:25-35, 66-70, 91-93`

The `X-Test-Mode: 1` HTTP header and `?test` query parameter permanently disable both CSRF origin checks and session-token authentication for all PHI routes. No guard restricts this to test environments. Any HTTP client can send this header to read/write all clinical notes and reports without credentials.

**Fix**: Gate on `os.environ.get('FLASK_ENV') == 'test'`, or remove the bypass entirely and have Playwright tests obtain real session tokens.

### 2. No rate limiting on login/signup endpoints [Security]

`server/routes/auth.py:87 (login), :47 (signup)`

Unlimited password guessing against known email addresses. No account lockout, CAPTCHA, or exponential backoff. The error message differentiation between "Email already registered" and login failure enables email enumeration.

**Fix**: IP-based and email-based rate limiting (5 attempts per 15min per IP). Log failed attempts to audit log.

### 3. read_scan_manifest widens AllowedPaths without user authorization [Security, Hardener]

`desktop/src-tauri/src/scan.rs:19-35`

The `read_scan_manifest` IPC command accepts arbitrary root paths from JS and permanently adds them to the process-wide `AllowedPaths` before any validation. JS can whitelist any filesystem path, then access it via decode commands. Only paths chosen through the OS dialog should authorize new roots.

**Fix**: Remove `add_root` from `read_scan_manifest`. Only paths from native dialog results should widen the scope.

### 4. Flask serves PHI over plain HTTP [Security]

`app.py:47-68, server/__init__.py:95-103`

The session token is transmitted in cleartext. When bound to `0.0.0.0`, any host on the network can capture the token and replay it to read/write all PHI.

**Fix**: Require TLS for non-loopback hosts, or enforce `127.0.0.1` binding as the hard default.

### 5. persistence.rs is dead code but JS depends on its Tauri commands [Hardener]

`desktop/src-tauri/src/persistence.rs (~534 lines), desktop/src-tauri/src/main.rs:303-315`

`persistence.rs` defines `apply_desktop_migration` and `load_legacy_desktop_browser_stores` commands. JS calls them at runtime (`docs/js/persistence/desktop.js:601, :614`). But the module is never declared in `main.rs` (`mod persistence` is missing) and the commands are not in `generate_handler!`. Desktop legacy migration (localStorage to SQLite) is silently broken. `sqlx` dependency is also dead weight.

**Fix**: Either re-enable the module or remove it and the dead JS call sites.

### 6. Cross-user sync version counter [Code Review, Security]

`server/sync/delta.py:202-219`

`_next_sync_version` allocates versions from `MAX(sync_version)` across ALL users, not per-user. User A's writes inflate User B's version watermark. Clients joining a multi-user deployment may permanently miss remote changes. Also leaks cross-user activity volume (a privacy concern for medical data).

**Fix**: Pass `user_id` to `get_max_sync_version` (the per-user variant already exists).

### 7. Native decode debug mode logs full filesystem paths (PHI in logs) [Security]

`desktop/src-tauri/src/decode.rs:272-282, 307-316, 474-484, 506-516`

When `--native-decode-debug` is active, `eprintln!` includes full absolute file paths. Patient-organized DICOM libraries use paths like `/Users/alice/DICOMs/JOHN_DOE_20260101/CT_CHEST/slice001.dcm`. Patient names leak into system logs.

**Fix**: Replace `path.display()` with the existing `path_util::redact_path()` in all debug log lines.

---

## MEDIUM

### 8. Phantom study creation for remote report upserts [Code Review]

`docs/js/app/sync-engine.js:590`

`_applyRemoteData` reports branch calls `ensureStudy(store, studyUid)` unconditionally before checking if the study exists locally. Remote reports for studies not on the local device create empty study stubs that appear as "Unknown" in the library. The comments tombstone path (lines 533-539) has the correct guard but the reports path doesn't.

**Fix**: Check `if (!store.studies[studyUid]) return;` before `ensureStudy` for new report inserts.

### 9. Refresh tokens cannot be revoked [Code Review]

`server/auth/jwt_utils.py`

Refresh tokens are stateless JWTs with 30-day TTL, not stored in the database. No logout endpoint, no revocation list. A leaked refresh token provides 30 days of authenticated PHI access with no way to terminate it.

**Fix**: Store refresh token hashes in a `device_tokens` table. Add `POST /api/auth/logout` that revokes the token.

### 10. Three near-identical Rust metadata structs [Hardener]

`desktop/src-tauri/src/decode.rs:54-142`

`DecodeFrameMetadata`, `DecodeFrameBinaryHeader`, and `DecodedFrameMetadata` carry the same 12 fields with two manual field-by-field conversion functions. ~90 lines of structural duplication.

**Fix**: Collapse to two structs using `#[serde(flatten)]` or `Option<String>` for `decode_id`.

### 11. waitForDesktopRuntime duplicated across 4+ files [Hardener]

`docs/js/persistence/desktop.js:148-161, docs/js/app/main.js:278-300, docs/js/app/update-ui.js:87-110, docs/js/app/reports-ui.js:255`

Four independent implementations of the same polling loop (check `window.__TAURI__`, await ready promise, poll every 50ms with 5s timeout). Slightly different timeouts and API subset checks.

**Fix**: Extract `waitForTauriRuntime(requiredApis)` into `tauri-compat.js`.

### 12. Tauri fs:scope grants access to all of $APPDATA [Security]

`desktop/src-tauri/capabilities/default.json:12-35`

The capability grants full read/write/rename/remove to `$APPDATA/**` instead of just the app-specific subdirectory. A compromised webview could access other apps' data under `~/Library/Application Support/`.

**Fix**: Narrow scope to `$APPDATA/health.divergent.dicomviewer/**`.

### 13. /api/notes/migrate lacks user scoping [Security]

`server/routes/reports.py:321-402`

The migration endpoint writes to shared (non-user-scoped) tables without validating study UID ownership. In multi-tenant cloud mode, any authenticated user could write notes under arbitrary study UIDs.

**Fix**: Gate with cloud auth and scope to `cloud_study_notes` in cloud mode, or remove after migration is complete.

### 14. help-content.js HTML injected raw via innerHTML [Security]

`docs/js/app/help-viewer.js:51-60`

`section.content` is developer-authored static HTML, but `innerHTML` injection without sanitization is an architectural XSS risk. The CSP's `script-src 'self'` blocks inline `<script>` but not `<img onerror=...>` or `<svg onload=...>`.

**Fix**: Use DOMPurify or the Sanitizer API, or build help content with `document.createElement` + `textContent`.

### 15. _add_column uses f-string SQL interpolation [Security, Hardener]

`server/db.py:490-499`

`ALTER TABLE {table} ADD COLUMN {column} {col_type}` with no validation. All callers pass literals today, but no guard prevents future misuse.

**Fix**: Add `assert re.match(r'^[a-z_]+$', table)` validation.

### 16. enqueueChange reliability gap on desktop [Code Review]

`docs/js/persistence/sync.js:322-344`

Pushes to in-memory `desktopCache.outbox` before SQLite INSERT. Process kill between push and INSERT permanently loses the entry.

**Fix**: INSERT to SQLite first, then update in-memory cache on success.

### 17. Comment time field overwritten with updated_at on remote sync [Code Review]

`docs/js/app/sync-engine.js:551`

When updating an existing comment from remote data, the display timestamp (`time`) is overwritten with `data.updated_at`. The creation timestamp shifts to the edit time on every sync cycle.

**Fix**: Use `data.created_at || existing.time` for the `time` field. `updated_at` is a separate concern.

### 18. Report blob upload reads entire file into memory [Security]

`server/routes/sync.py:262-273`

The entire upload body (up to 50MB per Flask's `MAX_CONTENT_LENGTH`) is read into memory before hash verification. Multiple concurrent uploads can push the server into high memory pressure.

**Fix**: Stream to a temp file first, compute hash in chunks.

### 19. log_frontend_decode_event has no input length validation [Security]

`desktop/src-tauri/src/main.rs:127-131`

Accepts arbitrary-length strings from JS and writes them to stderr. A malicious or buggy caller could pass hundreds of MB, exhausting disk or memory.

**Fix**: Cap `message` to 4096 bytes.

---

## LOW

### 20. Dead CONFIG helper methods [Hardener]

`docs/js/config.js:129-170`

`isCloudPlatform()`, `isDemo()`, `isPreview()`, `isPersonal()`, `getModeName()` -- never called anywhere. ~40 lines of dead code.

### 21. shouldPersistNotes always returns true [Hardener]

`docs/js/config.js:121-123, docs/js/persistence/dispatcher.js:42-47`

Hardcoded to `true` in all modes. Eight guard clauses in the dispatcher that always pass.

### 22. Duplicated path normalization across JS modules [Hardener]

`docs/js/app/library.js:26-40, docs/js/app/import-pipeline.js:57-61, docs/js/app/dicom.js:146`

Three modules implement backslash-to-forward-slash normalization and parent directory extraction independently.

### 23. Duplicated hasOwn helper [Hardener]

`docs/js/app/utils.js:4-5, docs/js/persistence/sync.js:15-16`

Identical polyfill in two files. `Object.hasOwn()` is already supported in all targeted browsers.

### 24. Duplicated test helpers across spec files [Hardener]

`tests/auth-security.spec.js, tests/maintenance.spec.js, tests/sync-helpers.js`

`uniqueStudyUid`, `uniqueSeriesUid`, `BASE_URL` copied instead of importing from the existing shared `notes-test-helpers.js`.

### 25. toDicomByteArray partially duplicates normalizeBinaryResponse [Hardener]

`docs/js/app/dicom.js:11-29, docs/js/app/utils.js:80-97`

Both handle `Uint8Array`, `ArrayBuffer`, and typed array views identically. ~10 lines of overlapping coercion logic.

### 26. sqlx dependency may be unnecessary [Hardener]

`desktop/src-tauri/Cargo.toml:23`

Only used in `persistence.rs` which is dead code. Adds ~30s to clean builds and ~5MB to binary.

### 27. Event listeners in reports-ui.js may accumulate [Hardener]

`docs/js/app/reports-ui.js:239`

Document-level click handler added for context menu dismissal. Confirm it's only added once.

### 28. DecodeFrameMetadata.bits_stored missing from Rust [Hardener]

`desktop/src-tauri/src/decode.rs:56-70`

JS reads `nativeDecoded.bitsStored` but the Rust struct doesn't include it. Falls back to DICOM header parse.

### 29. Cross-user blob linkage via content-addressed storage [Security]

`server/routes/sync.py:248-259`

Two users uploading the same PDF share the same blob on disk. Reveals whether another user has the identical file.

### 30. SQLite file permissions not hardened [Security]

`server/db.py:116-120`

Database files created with default umask (typically 0644). World-readable on the same system.

### 31. Hostname substring match for cloud mode [Security]

`docs/js/config.js:54-60`

`hostname.includes('divergent.health')` matches `evil-divergent.health.attacker.com`.

### 32. Debug settings exposed to JS in production [Security]

`desktop/src-tauri/src/main.rs:121-124`

`get_debug_settings` IPC command exposes debug flags to any webview JS. Should be `#[cfg(debug_assertions)]` gated.

### 33. No magic-byte validation on report uploads [Security]

`server/db.py:518-534`

MIME type determined from client-provided values. An HTML file with `.pdf` extension is accepted as PDF.

### 34. @playwright/test in dependencies instead of devDependencies [Hardener]

`package.json:44-47`

### 35. Unused CSS design tokens [Hardener]

`docs/css/style.css:69-130`

Some `--color-emerald-*` variables defined but never referenced.

### 36. Duplicate dispatchSyncEvent implementations [Hardener, Code Review]

`docs/js/persistence/sync.js:177, docs/js/app/sync-engine.js:127-130`

Identical functions in two modules.

### 37. console.log left in production rendering code [Code Review]

`docs/js/app/rendering.js:716`

`console.log('Transfer Syntax:', ...)` fires on every slice decode.

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH | 7 |
| MEDIUM | 12 |
| LOW | 18 |
| **Total** | **37** |

### Priority recommendations

**Immediate (before cloud launch)**:
1. Gate test-mode auth bypass on environment variable (#1)
2. Add rate limiting to login/signup (#2)
3. Fix cross-user sync version counter (#6)
4. Re-enable or remove dead persistence.rs (#5)

**Before next release**:
5. Fix AllowedPaths scope widening (#3)
6. Redact paths in native decode debug logs (#7)
7. Fix phantom study creation for remote reports (#8)
8. Add refresh token revocation (#9)

**Maintenance backlog**:
9. Narrow Tauri fs:scope (#12)
10. Consolidate duplicated waitForDesktopRuntime (#11)
11. Consolidate Rust metadata structs (#10)
12. Everything else

### What's solid

- **All SQL uses parameterized queries** -- no injection vectors found across Flask, sync, and persistence layers
- **Path traversal defense at multiple layers** -- `resolve_canonical_path` + `AllowedPaths` + symlink blocking
- **XSS prevention** -- `escapeHtml()` consistently applied on all DICOM metadata and user input before HTML insertion
- **Tauri CSP is well-crafted** -- no `unsafe-eval`, no external `script-src`, no wildcard `connect-src`
- **Sync cursor system** -- 256-bit random tokens, ownership-validated, not enumerable
- **JWT type validation** -- access/refresh token types are checked, preventing cross-use
- **Credentials in OS keyring** -- not stored as plaintext files
- **HIPAA audit logging** -- all PHI route accesses logged with hashed session tokens
- **Atomic file writes** -- report uploads use temp + rename pattern throughout
- **Content-hash integrity** -- sync blob uploads verify SHA-256 before accepting
