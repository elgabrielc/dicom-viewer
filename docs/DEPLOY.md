# DICOM Viewer - Deployment Guide

<!-- Copyright (c) 2026 Divergent Health Technologies -->

This document covers deployment options for the DICOM Viewer, including local development, GitHub Pages hosting, and our CI/CD pipeline.

---

## Overview

The DICOM Viewer is a **static single-page application** that runs entirely in the browser. All DICOM processing happens client-side using JavaScript and WebAssembly. This means:

- No server-side processing required
- Any HTTP server can host it
- GitHub Pages works out of the box
- Medical images never leave the user's machine

The application consists of static files in the `docs/` folder:

```
docs/
├── index.html          # Main application (SPA)
├── css/style.css       # Styles
├── js/                 # JavaScript + WASM codecs
├── sample/             # Demo CT scan (optional)
└── sample-mri/         # Demo MRI scan (optional)
```

---

## Local Development

### Option 1: Flask Server (Recommended for Development)

Flask provides the development server with test mode API support.

**Setup:**
```bash
cd "/Users/gabriel/claude 0/dicom-viewer"
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Run:**
```bash
python app.py
```

**Access:**
- Normal mode: http://localhost:5001
- Test mode: http://localhost:5001/?test

**Why Flask for development:**
- Test mode API (`/api/test-data/`) bypasses File System Access API
- Enables automated Playwright testing
- Consistent with production behavior
- Hot reload not needed (static files, no build step)

### Option 2: Static File Server

For simple local viewing without test mode features.

**Python (built-in):**
```bash
cd "/Users/gabriel/claude 0/dicom-viewer/docs"
python3 -m http.server 8000
```

**Node.js (serve package):**
```bash
npx serve docs -p 8000
```

**Access:** http://localhost:8000

**Limitations:**
- No test mode API (cannot use `?test` parameter)
- Automated tests require Flask server
- No server-side debugging

---

## Development Workflow

We use **GitHub Flow** for development:

```
Feature Branch ──PR──► main ──auto──► GitHub Pages (demo)
                  │
                  └──► Vercel Preview (per-PR staging)
```

### Branch Strategy

1. `main` is always deployable (it's the live demo)
2. All work happens in feature branches
3. PRs must pass CI before merge
4. Self-merge allowed after CI passes

Branch naming: `feature/<name>`, `fix/<name>`, `docs/<name>`

### Making Changes (Recommended Flow)

```bash
# 1. Create feature branch
git checkout main && git pull
git checkout -b feature/my-change

# 2. Make and test changes locally
# ... edit files, run tests ...

# 3. Commit and push
git add <files>
git commit -m "feat: description"
git push -u origin feature/my-change

# 4. Open PR on GitHub
# CI runs automatically, Vercel creates preview

# 5. After CI passes, merge PR
# GitHub Pages updates automatically
```

---

## CI/CD Pipeline

### GitHub Actions (PR Validation)

Every PR to `main` triggers `.github/workflows/pr-validate.yml`:

1. Installs Python + Node dependencies
2. Runs all Playwright tests
3. Blocks merge if tests fail

**To run tests locally:**
```bash
npx playwright test
```

### Vercel Preview Environments

Each PR automatically gets a preview deployment:

- URL format: `dicom-viewer-git-<branch>-<username>.vercel.app`
- Updates on each push to the PR
- Good for visual verification before merge

**Setup (one-time):**
1. Connect repository to Vercel at vercel.com
2. Set Output Directory to `docs`
3. Preview deploys are enabled by default for PRs

---

## GitHub Pages Deployment

The project uses GitHub Pages to host the live demo.

### How It Works

1. GitHub Pages serves the `docs/` folder from the `main` branch
2. Repository setting: Settings > Pages > Source: `main` branch, `/docs` folder
3. Live URL: https://elgabrielc.github.io/dicom-viewer/

### Deployment Architecture

```
GitHub Repository (main branch)
└── docs/
    ├── index.html      ← Served as root
    ├── css/
    ├── js/
    ├── sample/         ← Demo data included
    └── sample-mri/
         │
         ▼
GitHub Pages CDN
         │
         ▼
https://elgabrielc.github.io/dicom-viewer/
```

### Updating the Live Site

**Via PR (recommended):**
1. Create feature branch with changes
2. Open PR, wait for CI
3. Merge after CI passes
4. GitHub Pages rebuilds automatically

**Direct push (not recommended):**
```bash
git push origin main
```
Note: Direct pushes bypass CI checks. Use PRs instead.

### Verifying Deployment

After pushing:

1. **Check build status:**
   - Go to repository > Actions tab
   - Look for "pages build and deployment" workflow
   - Green checkmark indicates success

2. **Verify live site:**
   - Navigate to https://elgabrielc.github.io/dicom-viewer/
   - Hard refresh (Cmd+Shift+R / Ctrl+Shift+R) to bypass browser cache
   - Test sample scan buttons to confirm functionality

3. **Clear CDN cache (if needed):**
   - Append `?v=timestamp` to URL for testing: `...dicom-viewer/?v=1706800000`
   - Wait 5-10 minutes for CDN propagation if changes don't appear

### File Size Considerations

GitHub Pages limits:
- Repository size: 1GB recommended maximum
- Individual file: 100MB maximum
- Bandwidth: 100GB/month

Current project footprint:
- `index.html`: ~128KB
- WASM decoders: ~500KB total
- Sample CT: ~20MB (188 slices)
- Sample MRI: ~25MB (242 slices)

The sample data is optional but included for demo purposes. Remove from `docs/` if bandwidth is a concern.

---

## Custom Domain Setup

**Current status:** Not configured. The application is served from the default GitHub Pages URL.

### To Add a Custom Domain

1. **DNS Configuration:**
   ```
   Type: CNAME
   Host: viewer (or subdomain of choice)
   Points to: elgabrielc.github.io
   ```

2. **GitHub Settings:**
   - Repository > Settings > Pages > Custom domain
   - Enter: viewer.divergent.health (example)
   - Enable "Enforce HTTPS"

3. **Create CNAME file:**
   ```bash
   echo "viewer.divergent.health" > docs/CNAME
   git add docs/CNAME
   git commit -m "Add custom domain"
   git push
   ```

4. **Wait for DNS propagation** (can take up to 24-48 hours)

---

## Environment Differences

| Aspect | Local (Flask) | Local (Static) | GitHub Pages |
|--------|--------------|----------------|--------------|
| URL | localhost:5001 | localhost:8000 | elgabrielc.github.io |
| HTTPS | No | No | Yes (enforced) |
| Test mode API | Yes | No | No |
| Sample data | Optional | Optional | Included |
| File System API | Requires Chrome/Edge | Requires Chrome/Edge | Requires Chrome/Edge |
| Hot reload | No | No | N/A |

### Important Notes

1. **HTTPS on GitHub Pages:**
   GitHub Pages enforces HTTPS. This is required for the File System Access API to work in production.

2. **Test mode is development-only:**
   The `?test` parameter only works with Flask because it requires server-side API endpoints. Production users must use drag-and-drop.

3. **Same static files everywhere:**
   Flask and GitHub Pages serve identical files from `docs/`. There's no build step, no environment variables, no server-side rendering. What you see locally is what users see.

4. **Browser requirements are the same:**
   Chrome 86+ or Edge 86+ required in all environments (File System Access API).

---

## Troubleshooting

### GitHub Pages Not Updating

**Symptoms:** Pushed changes don't appear on live site.

**Solutions:**
1. Check Actions tab for build errors
2. Hard refresh browser (Cmd+Shift+R)
3. Wait 5-10 minutes for CDN propagation
4. Verify correct branch/folder in Settings > Pages
5. Check if CNAME file exists and is correct (if using custom domain)

### 404 Errors on GitHub Pages

**Symptoms:** Page loads but assets (CSS, JS) return 404.

**Causes:**
- Incorrect relative paths in HTML
- Missing files in commit
- Case sensitivity issues (GitHub Pages is case-sensitive)

**Solutions:**
1. Verify files exist in `docs/` on the `main` branch
2. Check paths use correct case (`JS` vs `js`)
3. Use relative paths (`./css/style.css` not `/css/style.css`)

### CORS Errors Locally

**Symptoms:** Console shows "blocked by CORS policy" when loading WASM or sample data.

**Causes:**
- Opening `index.html` directly as file:// URL
- Missing proper headers from server

**Solutions:**
- Use HTTP server (Flask or `python -m http.server`)
- Never open `index.html` as a local file

### File System Access API Not Working

**Symptoms:** Drag-and-drop doesn't work, folder picker fails.

**Causes:**
- Using Firefox or Safari (not supported)
- Not using HTTPS (in production)
- Outdated browser version

**Solutions:**
- Use Chrome 86+ or Edge 86+
- Ensure HTTPS (automatic on GitHub Pages)
- Check browser console for specific error message

### Sample Data Not Loading

**Symptoms:** "CT Scan" or "MRI Scan" buttons don't load images.

**Causes (local):**
- CORS blocking sample folder access
- Sample data folders missing

**Causes (GitHub Pages):**
- Files not committed
- Large file blocking (>100MB)

**Solutions:**
1. Verify `docs/sample/` and `docs/sample-mri/` exist
2. Check network tab for failed requests
3. Ensure DICOM files are committed (not gitignored)

---

## Related Documentation

- **README.md** - Project overview and quick start
- **CLAUDE.md** - Technical architecture and development context
- **docs/TESTING.md** - Testing setup and practices
- **USER_GUIDE.md** - End-user documentation

---

*Last updated: 2026-02-01*
