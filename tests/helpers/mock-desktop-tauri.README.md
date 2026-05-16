# Mock Desktop Tauri Harness

`mock-desktop-tauri.js` installs the shared Playwright test double for the
desktop shell. It models the browser-visible Tauri runtime so desktop specs can
focus on application scenarios instead of rebuilding `window.__TAURI__`,
runtime-ready promises, filesystem behavior, SQL loading, and secure auth
commands in every file.

## Boundary

The harness owns desktop plumbing:

- `window.__TAURI__`
- runtime-ready promises
- `core.invoke`
- `core.convertFileSrc`
- filesystem commands
- path commands
- the SQL plugin bridge via `mock-tauri-sql-init.js`
- secure auth commands
- webview drag/drop stubs
- event plugin stubs

Specs still own domain fixtures:

- synthetic DICOM bytes
- DICOMDIR records
- scan manifests
- report payloads
- study, series, slice, note, and sync scenarios
- import-specific edge cases
- decode behavior

Keep the harness boring. If an option describes radiology behavior instead of
desktop runtime behavior, it belongs in the spec.

## Usage

Install the harness before navigation:

```js
const { installMockDesktopTauri } = require('./helpers/mock-desktop-tauri');

await installMockDesktopTauri(page, {
    appDataDir: '/mock/appdata',
    fs: {
        files: {
            '/mock/appdata/reports/example.pdf': [37, 80, 68, 70],
        },
    },
    sql: {
        initialState: {
            'sqlite:viewer.db': {
                reports: [],
            },
        },
    },
});

await page.goto(HOME_URL);
```

`installMockDesktopTauri()` uses serializable options because Playwright
`addInitScript` options cross the Node-to-browser boundary. For unusual cases,
install the default harness first, then patch the runtime in `page.evaluate()`
inside the test.

## Options

Options are grouped by runtime subsystem:

- `appDataDir`: returned by `window.__TAURI__.path.appDataDir()`.
- `secureAuthState`: initial secure auth state returned by
  `load_secure_auth_state`.
- `fs.files`: seeded filesystem bytes keyed by path.
- `fs.directories`: seeded directories.
- `fs.readDirEntries`: path-to-entry arrays returned by `readDir`.
- `fs.failWritePatterns`: substrings that make `writeFile` throw.
- `fs.failRemovePatterns`: substrings that make `remove` throw.
- `fs.failRemoveAll`: makes all `remove` calls throw.
- `invoke.legacyDesktopStores`: returned by
  `load_legacy_desktop_browser_stores`.
- `sql.initialState`: initial mock SQLite state.
- `sql.loadError`: make SQL load fail. Prefer this spelling in new tests.
- `sql.sqlLoadError`: migration alias for older mock-SQL option naming.
- `sql.selectDelayMs`: delay matching `select` calls.
- `sql.selectDelayPatterns`: lower-case query substrings that receive the
  delay.

Do not add flat top-level options for new behavior. Keep subsystem options under
`fs`, `invoke`, `sql`, or another explicit runtime domain.

## Loud Defaults

The default mock should be at least as strict as the real desktop runtime:

- Unknown `core.invoke` commands throw with the command name.
- `fs.exists` returns `false` for missing paths.
- `fs.readFile` and `fs.stat` throw for missing paths.
- Forgiving behavior must be opt-in through a named option.

When migrating a spec, keep negative-path assertions intact. A shared mock that
silently accepts everything makes tests easier to port but less useful.

## State Isolation

The helper keeps no mutable Node-side module state. Each browser install creates
a fresh `window.__mockDesktopTauriState` with:

- `reads`
- `writes`
- `invokeCalls`
- `mkdirCalls`
- `removeCalls`
- `renameCalls`
- `secureAuthState`

Use that browser-side state for assertions instead of adding global arrays in
the Node test file.

## Promotion Rule

Start with per-spec setup when a behavior is unique. Promote it into the
harness only when it models desktop runtime behavior and appears in at least
three specs, or when keeping it local would make tests disagree about the same
Tauri contract.
