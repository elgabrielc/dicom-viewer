# PR #118 Compat Runtime Refactor Follow-Ups

Filed: 2026-05-16. Hardener review of PR #118 surfaced items deferred out of scope. To be addressed before or after merge.

Context: PR #118 ("Export installCompatFromInternals + direct unit tests") is the 3rd PR in the v3 plan to make `installCompatFromInternals` unit-testable. The PR exports the function from `_testInternals` and adds direct Playwright tests. Hardener review flagged structural improvements deferred out of scope to keep the PR small.

## Medium

1. **Migrate `installCompatFromInternals` direct tests to a Node-side harness** -- `tests/desktop-runtime-compat.spec.js` (the `installCompatFromInternals (direct unit tests via _testInternals)` describe block). The function has zero DOM/browser dependencies once given an `internals` object. A Node-side test runner (Vitest, `node:test`, or `vm.runInNewContext` with `window` stubbed) eliminates the `page.evaluate` JSON serialization boundary that drove the duplication bug fixed in PR #118, runs 10-100x faster than Playwright, and allows direct assertions on returned objects without `page.evaluate` round-trips. After this lands, the Playwright describe block can be thinned to a single smoke test that asserts the no-library page bootstrap doesn't throw -- keeping the integration-flavored coverage without duplicating the unit coverage.

## Low

2. **Add an immutability assertion to `installCompatFromInternals` tests** -- same describe block. Production callers may pass the same `internals` (or share references with native code) and depend on the function not mutating its input. Verify by deep-cloning the input before the call and deep-comparing after. No test currently asserts this property.

3. **Restore `window.__TAURI__` after `installCompatFromInternals` tests** -- two tests in the describe block set `window.__TAURI__ = undefined` without restoring it. Playwright isolates pages per test by default, so this is not currently failing. Worth a `beforeEach`/`afterEach` save-and-restore pair (or `test.use({ storageState: ... })`) to make the test idempotent if Playwright's isolation behavior ever changes or if these tests are reused in a shared-context runner.
