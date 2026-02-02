<!--
  CONTRIBUTING.md - Contribution Guidelines for DICOM Viewer
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Contributing to DICOM Viewer

Thank you for your interest in contributing to the DICOM Viewer project. This document outlines the process and guidelines for contributing.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Code Style Guidelines](#code-style-guidelines)
3. [Git Workflow](#git-workflow)
4. [Pull Request Process](#pull-request-process)
5. [Reporting Issues](#reporting-issues)
6. [Code of Conduct](#code-of-conduct)

---

## Getting Started

### Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm
- **Chrome 86+** or **Edge 86+** (File System Access API requirement)
- **Git**

### Development Environment Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/elgabrielc/dicom-viewer.git
   cd dicom-viewer
   ```

2. **Create and activate Python virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Install Node.js dependencies**
   ```bash
   npm install
   npx playwright install chromium
   ```

4. **Start the development server**
   ```bash
   python app.py
   ```

5. **Open the viewer**
   - Normal mode: `http://127.0.0.1:5001/`
   - Test mode: `http://127.0.0.1:5001/?test`

### Project Structure

```
dicom-viewer/
├── docs/                    # Web assets (served by Flask and GitHub Pages)
│   ├── index.html          # Main SPA with all client-side logic
│   ├── css/style.css       # All styling (dark theme)
│   ├── js/                 # OpenJPEG WASM decoder files
│   ├── sample/             # Sample CT scan for demo
│   └── planning/           # Planning docs, bug tracking, research
├── tests/                   # Playwright test suites
├── app.py                   # Flask server
├── playwright.config.js     # Test configuration
└── CLAUDE.md               # Project context and conventions
```

---

## Code Style Guidelines

### Engineering Philosophy

Our guiding principle: *Slow is smooth, smooth is fast.*

- **Fix root causes, not symptoms** - Understand why before fixing what
- **Simplicity through discipline** - Simple solutions are harder to build but easier to maintain
- **Handle edge cases** - Real medical data is messy; expect it
- **Test what you build** - If it is worth building, it is worth verifying
- **Leave things better than you found them**

### JavaScript Conventions

This project uses **vanilla JavaScript** (no frameworks). Keep it that way.

**Naming:**
- Use `camelCase` for variables and functions
- Use `UPPER_SNAKE_CASE` for constants
- Use descriptive names (no single letters except loop indices)

**Structure:**
```javascript
// Good: Descriptive, clear intent
const patientName = dicomData.getString('x00100010');
const windowCenter = parseInt(metadata.windowCenter, 10);

// Bad: Cryptic, unclear purpose
const n = d.getString('x00100010');
const wc = parseInt(m.wc, 10);
```

**Functions:**
- Keep functions focused on a single responsibility
- Prefer pure functions where possible
- Handle error cases explicitly

**DOM Manipulation:**
- Use `getElementById` or `querySelector` consistently
- Cache DOM references when used repeatedly
- Avoid inline event handlers in HTML

### Python Conventions

Follow PEP 8 with these project-specific notes:

- **Line length**: 100 characters maximum
- **Imports**: Group by standard library, third-party, local
- **Docstrings**: Use triple quotes for functions with non-obvious behavior
- **Type hints**: Encouraged for function signatures

```python
# Good
def get_dicom_metadata(file_path: str) -> dict:
    """Extract relevant DICOM tags from a file."""
    pass

# Bad
def get_meta(f):
    pass
```

### CSS Conventions

- **Dark theme optimized** for radiologist viewing environment
- Use CSS custom properties (variables) for colors
- Mobile-first is not a priority (desktop application)
- Prefer class selectors over ID selectors for styling
- Group related properties together

```css
/* Good: Grouped, using variables */
.viewer-toolbar {
    display: flex;
    gap: 8px;
    background: var(--toolbar-bg);
    border-bottom: 1px solid var(--border-color);
}

/* Bad: Random order, hardcoded values */
.viewer-toolbar {
    border-bottom: 1px solid #333;
    display: flex;
    background: #1a1a1a;
    gap: 8px;
}
```

### Comment Style

Comments explain **why**, not **what**. The code shows what; comments provide context.

```javascript
// Good: Explains the "why"
// MRI images without embedded W/L need auto-calculation from pixel statistics
// because different MRI sequences have vastly different signal intensities
if (!windowCenter && modality === 'MR') {
    calculateAutoWindowLevel(pixelData);
}

// Bad: Restates the code
// If window center is not set and modality is MR
if (!windowCenter && modality === 'MR') {
    calculateAutoWindowLevel(pixelData);
}
```

---

## Git Workflow

### Branch Naming Conventions

Use descriptive branch names with a prefix indicating the type:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New functionality | `feature/volume-rendering` |
| `fix/` | Bug fixes | `fix/jpeg2000-decode-error` |
| `refactor/` | Code restructuring | `refactor/dicom-parser` |
| `docs/` | Documentation only | `docs/api-reference` |
| `test/` | Test additions/fixes | `test/slice-navigation` |

### Commit Message Format

Write clear, descriptive commit messages that explain the change and its purpose.

**Structure:**
```
<type>: <short summary>

<body - explain what and why, not how>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or modifying tests
- `docs`: Documentation changes
- `style`: Formatting, missing semicolons, etc.
- `perf`: Performance improvement

**Example:**
```
feat: Add modality-aware window/level defaults

CT images now default to soft tissue window (C:40, W:400) on load.
MRI images without embedded W/L values auto-calculate from pixel
statistics. This provides a reasonable starting point for viewing
without manual adjustment.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Important Git Rules

1. **Never push without explicit permission** - Commit when ready, but wait for explicit approval to push

2. **Review deletions before committing** - Any deletion of 3+ lines should be justified and reviewed

3. **Check Feature Inventory before removing code** - Features listed in `CLAUDE.md` must be discussed before removal

4. **Never force push to main** - Rewriting shared history causes problems for all contributors

### Staging and Committing

```bash
# Stage specific files (preferred over git add -A)
git add docs/index.html docs/css/style.css

# Review what will be committed
git diff --staged

# Commit with message
git commit -m "feat: Add zoom controls to toolbar"
```

---

## Pull Request Process

### Before Submitting a PR

1. **Run the test suite**
   ```bash
   npx playwright test
   ```
   All tests must pass.

2. **Test manually in the browser**
   - Load a DICOM folder and verify your changes work
   - Check edge cases (blank slices, different modalities, large series)

3. **Check for regressions**
   - Verify existing features still work
   - Reference the Feature Inventory in `CLAUDE.md`

4. **Update documentation if needed**
   - Update `docs/planning/SITEMAP.md` for structural changes
   - Add entries to `docs/BUGS.md` if fixing bugs

### Submitting a PR

1. Push your branch to the remote (after receiving permission)

2. Create a pull request with:
   - **Title**: Clear, concise summary (under 70 characters)
   - **Description**: Explain what changed and why
   - **Testing**: Describe how you verified the changes

3. Link any related issues

### What Reviewers Look For

- **Correctness**: Does the code do what it claims?
- **Simplicity**: Is this the simplest solution that works?
- **Edge cases**: Are error conditions handled?
- **Tests**: Are new features tested? Are tests meaningful?
- **Documentation**: Are changes documented where needed?
- **No regressions**: Do existing features still work?

### After Review

- Address feedback promptly
- Keep commits atomic (one logical change per commit)
- Do not squash commits during review (makes it harder to track changes)

---

## Reporting Issues

### Bug Reports

Create an issue using this format (based on `docs/BUGS.md` template):

```markdown
### Summary
One-sentence description of the problem.

### Steps to Reproduce
1. Load a DICOM folder with [specific characteristics]
2. Navigate to slice [X]
3. Click [button/perform action]
4. Observe [unexpected behavior]

### Expected Behavior
What should happen.

### Actual Behavior
What actually happens.

### Environment
- Browser: Chrome 120
- OS: macOS Sonoma
- DICOM data type: MRI T1-weighted, JPEG Lossless

### Screenshots
If applicable, attach screenshots or console errors.
```

### Feature Requests

Feature requests should include:

```markdown
### Summary
Brief description of the proposed feature.

### Use Case
Who needs this and why? What problem does it solve?

### Proposed Solution
How might this work? (Optional but helpful)

### Alternatives Considered
Other approaches you thought about.

### Additional Context
Any other relevant information.
```

---

## Code of Conduct

### Our Standards

- **Be respectful** - Treat all contributors with respect
- **Be constructive** - Provide actionable feedback, not criticism
- **Be patient** - Not everyone has the same experience level
- **Be professional** - Keep discussions focused on the work
- **Be honest** - Acknowledge mistakes and learn from them

### Unacceptable Behavior

- Personal attacks or insults
- Harassment of any kind
- Publishing private information without permission
- Deliberately disruptive behavior

### Enforcement

Violations may result in temporary or permanent exclusion from the project. Report concerns to the project maintainer.

---

## Questions?

If you have questions about contributing, open an issue with the `question` label or review the project documentation in `CLAUDE.md` and `docs/`.

---

*Copyright (c) 2026 Divergent Health Technologies*
