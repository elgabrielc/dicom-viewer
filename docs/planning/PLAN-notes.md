# Notes Feature Plan

## Overview

Allow users to add personal annotations to studies and series for tracking observations, marking images for follow-up, or keeping notes.

**Status**: Implemented with localStorage persistence

---

## What Are Notes?

Notes is the umbrella term for user-added text on studies and series. There are two types:

| Type | Purpose | UI |
|------|---------|-----|
| **Description** | Free-form text field for general notes | Textarea in the expanded panel |
| **Comments** | Timestamped entries for tracking observations over time | List of dated entries with add/edit/delete |

Both types persist to localStorage and are restored when the same DICOM files are loaded again.

---

## Current Implementation

### What's Built

**Descriptions:**
- Free-form textarea on studies and series
- Auto-saves on every keystroke
- No timestamps (just the current text)

**Comments:**
- Add/edit/delete timestamped entries
- Comment count badges on study/series rows
- Expandable comment panels
- Edit via browser prompt dialog
- Keyboard support (Enter to submit)

### Storage

Notes (both descriptions and comments) are persisted to localStorage automatically. They survive:
- Page refresh
- Tab close
- Browser restart

**localStorage key**: `dicom-viewer-comments`

**Storage format**:
```javascript
{
  "version": 1,
  "comments": {
    "[studyInstanceUid]": {
      "description": "Free-form study notes...",
      "study": [{ "text": "Timestamped comment", "time": 1706812800000 }],
      "series": {
        "[seriesInstanceUid]": {
          "description": "Free-form series notes...",
          "comments": [{ "text": "Series comment", "time": 1706812800000 }]
        }
      }
    }
  }
}
```

Notes are loaded when studies are displayed, matching by StudyInstanceUID and SeriesInstanceUID.

### UI Location

- **Study notes**: Expand the comment panel via the button in the rightmost column
  - Description textarea at the top
  - Comments list below with "Add comment" input
- **Series notes**: Expand the series row, then click the comment button
  - Same layout: description textarea + comments list

---

## Design Decisions

### Why Two Types of Notes?

**Decision**: Separate descriptions (free-form) from comments (timestamped entries).

**Rationale**:
1. **Different use cases** - Descriptions capture current state; comments track observations over time
2. **Familiar patterns** - Mirrors issue trackers (description + comment thread)
3. **Simple merge path** - When server sync is added, both are just text fields

### Why localStorage Persistence

**Decision**: Notes persist to localStorage automatically.

**Rationale**:
1. **User expectation** - Notes should not disappear on refresh
2. **Foundation for server sync** - localStorage structure maps to future server-side storage
3. **No server dependency** - Still fully client-side
4. **Simple implementation** - Save on every mutation, load on display

**Privacy note**: This is a personal tool, not a shared kiosk. Users on shared computers should clear browser data.

### Why No Rich Text

**Decision**: Plain text only, no markdown or formatting.

**Rationale**:
1. Notes are annotations, not documents
2. Simpler implementation
3. No XSS concerns from rendered HTML
4. Easier to copy/paste elsewhere

### Why Browser Prompt for Comment Edit

**Decision**: Use `prompt()` dialog instead of inline editing.

**Rationale**:
1. Simpler implementation
2. Works consistently across browsers
3. Clear modal interaction

**Known limitation**: Poor UX for long comments. Acceptable for MVP.

---

## Future Improvements

### High Priority

| Improvement | Rationale |
|-------------|-----------|
| Inline comment editing | Better UX than prompt() dialog |
| Export notes | Let users save their notes before closing |
| Confirmation on delete | Prevent accidental deletion |

### Medium Priority

| Improvement | Rationale |
|-------------|-----------|
| Notes search | Find notes across studies |
| Keyboard navigation | Tab through comments, delete with key |
| Server-side sync | Sync notes across devices with user accounts |

### Low Priority / Future Consideration

| Improvement | Rationale |
|-------------|-----------|
| Rich text / markdown | More expressive notes |
| Annotation linking | Link note to specific slice or region |
| Export with DICOM | Embed notes in DICOM structured reports |

---

## Testing

### Current Coverage

No automated tests for notes feature.

### Recommended Tests

```javascript
// Notes - Add description to study
test('Notes - Add study description - Text persists', async ({ page }) => {
  // Load viewer, type in description, verify it saves
});

// Notes - Add comment to study
test('Notes - Add study comment - Comment appears with timestamp', async ({ page }) => {
  // Load viewer, add comment, verify it appears
});

// Notes - Add description to series
test('Notes - Add series description - Text persists', async ({ page }) => {
  // Expand study, type in series description, verify
});

// Notes - Add comment to series
test('Notes - Add series comment - Comment appears under series', async ({ page }) => {
  // Expand study, add series comment, verify
});

// Notes - Edit comment
test('Notes - Edit comment - Text updates with new timestamp', async ({ page }) => {
  // Add comment, edit it, verify changes
});

// Notes - Delete comment
test('Notes - Delete comment - Comment removed from list', async ({ page }) => {
  // Add comment, delete it, verify gone
});

// Notes - Count badge
test('Notes - Multiple comments - Badge shows correct count', async ({ page }) => {
  // Add 3 comments, verify badge shows "3 comments"
});

// Notes - Persistence within session
test('Notes - Navigate away and back - Notes persist', async ({ page }) => {
  // Add notes, view different series, return, verify still there
});

// Notes - Persistence across refresh
test('Notes - Page refresh - Notes persist in localStorage', async ({ page }) => {
  // Add notes, reload page, reload same DICOM, verify still there
});
```

---

## Implementation Notes

### Code Location

All notes code is in `docs/index.html`:
- Comment functions (render, add, edit, delete, updateUI)
- Persistence functions (saveCommentsToStorage, loadCommentsFromStorage)
- Notes UI in study/series table rendering
- Description input handlers

### State Structure

```javascript
state.studies[studyUid] = {
  // ... other study properties
  description: "Free-form study notes",
  comments: [
    { text: "Timestamped comment", time: 1706812800000 },
    // ...
  ],
  series: {
    [seriesUid]: {
      // ... other series properties
      description: "Free-form series notes",
      comments: [
        { text: "Series comment", time: 1706812800000 },
        // ...
      ]
    }
  }
}
```

---

*Last updated: 2026-02-01*
