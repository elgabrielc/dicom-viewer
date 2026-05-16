# ADR 015: Shared Desktop Test Harness

## Status

Implemented

## Context

The desktop Playwright specs have to run browser code that normally expects a
Tauri desktop shell. Before this ADR, each spec hand-rolled enough of that
runtime to make its own scenarios pass. That repeated setup covered the same
basic surfaces in slightly different ways: `window.__TAURI__`, filesystem
commands, path helpers, SQL loading, secure auth commands, drag/drop stubs, and
runtime-ready promises.

The duplication created two risks:

- Specs could disagree about what "desktop Tauri" means.
- A test could pass because its local mock was more forgiving than the real
  runtime or another spec's mock.

PR 115 added a real-Tauri launch smoke suite as a fidelity floor. That suite is
intentionally small and slow-running. The regular Playwright desktop specs still
need a shared browser-side mock so they can be fast while staying consistent.

## Decision

Create a shared desktop runtime harness at
`tests/helpers/mock-desktop-tauri.js`.

Desktop specs install it with one Node-side helper:

```js
await installMockDesktopTauri(page, options);
```

The harness owns desktop plumbing: Tauri globals, runtime-ready promises,
`core.invoke`, filesystem commands, path commands, SQL plugin loading, secure
auth commands, webview drag/drop stubs, and event plugin stubs. Specs continue
to own domain fixtures such as DICOM bytes, scan manifests, report payloads,
study notes, sync data, and scenario-specific edge cases.

The first migration moves `tests/desktop-report-persistence.spec.js` onto the
shared harness and adds helper smoke/contract coverage.

## Alternatives Considered

### Keep per-spec mocks

Rejected. Per-spec mocks are easy to tune locally, but they accumulate drift and
make desktop test failures harder to trust.

### Variant-based helper

Rejected for now. An API such as `installMockTauri({ variant: 'import' })`
would make early migrations short, but it would bake spec names into the helper
and encourage a growing switch statement.

### Multiple named installers

Rejected for now. Separate helpers such as `installLibraryTauri` and
`installImportTauri` would be discoverable, but they would duplicate internal
setup and make mixed concerns awkward.

### Playwright fixtures

Rejected for this phase. The existing test suite uses imperative setup rather
than `test.extend`. Keeping the harness imperative minimizes migration churn.

## Design Details

- `installMockDesktopTauri(page, options)` must be called before navigation.
- Options are grouped by runtime subsystem: `fs`, `invoke`, `sql`, plus
  top-level runtime identity options such as `appDataDir` and
  `secureAuthState`.
- The helper exports `READY_PROMISE_NAMES`, currently
  `__DICOM_VIEWER_TAURI_STORAGE_READY__` and `__DICOM_VIEWER_TAURI_READY__`.
- The harness pre-injects both ready promises and resolves them to the
  installed mock runtime.
- The SQL mock is reused through `tests/mock-tauri-sql-init.js`; this ADR does
  not replace the existing SQL helper.
- Unknown `core.invoke` commands throw with the command name.
- Missing files follow Tauri-like defaults: `fs.exists` returns `false`, while
  `fs.readFile` and `fs.stat` throw.
- Every install creates fresh browser-side state at
  `window.__mockDesktopTauriState`. The Node module keeps no mutable per-test
  state.
- The helper uses JSON-serializable options only. Highly custom behavior should
  be layered on with `page.evaluate()` after installing the default harness.
- Contract tests cover loud unknown invokes, missing-file defaults, and ready
  promise resolution. A normalized real-Tauri golden recorder remains a future
  hardening step once the launch smoke suite is stable enough to support it.

## Consequences

Positive:

- Desktop specs share one canonical mock for the Tauri shell.
- Report-persistence tests lose duplicated setup while preserving their
  negative-path coverage.
- Future migrations can make smaller diffs by reusing the same runtime surface.
- Browser-side call tracking is available through
  `window.__mockDesktopTauriState` without per-spec global arrays.

Tradeoffs:

- The helper becomes a shared dependency for multiple desktop specs, so changes
  need focused contract tests and careful review.
- A shared mock can become too permissive if every test-specific quirk is
  promoted. New options should be added only when they model desktop runtime
  behavior rather than domain behavior.
- The current contract tests are intentionally lightweight. They guard the most
  important defaults, but they do not replace the real-Tauri smoke suite or a
  future normalized golden recording.

## Extension Rules

- Keep subsystem options grouped. Do not add new flat option flags.
- Preserve loud defaults. Forgiving behavior must be opt-in.
- Promote behavior into the harness only when it appears in at least three
  specs or represents a shared Tauri contract.
- Keep domain fixtures in specs.
- When migrating a spec, its focused Playwright test count must remain the same
  and all negative-path assertions must still run.

