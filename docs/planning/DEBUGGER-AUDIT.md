# DICOM Viewer — Comprehensive Debugging Audit

**Date**: 2026-03-10
**Auditor**: Claude Debugger Agent (claude-sonnet-4-6)
**Scope**: Full codebase — DICOM parsing, rendering pipeline, state management, memory
management, error handling, browser API usage, test coverage gaps, Tauri desktop integration,
Flask backend

---

## Overview

The codebase is well-structured and thoughtfully organized. There are no catastrophic silent
data-corruption bugs. The issues below range from rendering logic bugs that produce visually
incorrect output on specific image types, to missing concurrency guards, to cleanup gaps and
test coverage holes.

**Severity counts**: 2 High · 15 Medium · 20 Low (37 total)

---

## Table of Contents

1. [DICOM Parsing Correctness](#1-dicom-parsing-correctness)
2. [Rendering Pipeline](#2-rendering-pipeline)
3. [State Management](#3-state-management)
4. [Memory Management](#4-memory-management)
5. [Error Handling](#5-error-handling)
6. [Browser API Usage](#6-browser-api-usage)
7. [Test Coverage Gaps](#7-test-coverage-gaps)
8. [Tauri Desktop Integration](#8-tauri-desktop-integration)
9. [Flask Backend](#9-flask-backend)
10. [Priority Summary](#10-priority-summary)

---

## 1. DICOM Parsing Correctness

---

### [HIGH-1] `decodeJpegBaseline` discards all color data and mislabels the result

**File**: `docs/js/app/dicom.js`, lines 665–688
**Severity**: High
**Impact**: JPEG Baseline color images — color secondary captures, color US, color fluoroscopy
screenshots — render as grayscale using only the red channel. The image is visually degraded
with no warning to the user.

The function decodes the JPEG via the browser's native `createImageBitmap`, reads the RGBA
pixel data, then extracts only the red channel:

```js
// dicom.js lines 679–684
const pixels = new Int16Array(rows * cols);
for (let i = 0; i < pixels.length; i++) {
    pixels[i] = imageData.data[i * 4]; // Just use red channel
}
return { pixels, isRgb: true };
```

Back in `decodeDicom` (rendering.js lines 489–496), the `isRgb` flag causes the caller to
force `decodedPhotometricInterpretation = 'MONOCHROME2'` and set `skipWindowLevel = true`,
so the single-channel data is treated as a pre-scaled 0–255 grayscale image. For a
true-grayscale JPEG (where R = G = B for every pixel) this is lossless. For a color JPEG the
G and B channels are silently thrown away.

**Recommended fix**: Check whether the decoded image is actually grayscale by comparing
whether R ≈ G ≈ B. If it is color, return a full 3-channel `Uint8Array` with
`samplesPerPixel = 3` and `planarConfiguration = 0`, allowing the existing RGB rendering path
in `renderPixels` (rendering.js lines 729–744) to handle it. The RGB rendering path already
exists and is correct.

---

### [MEDIUM-1] Manual encapsulated pixel data fallback path has no bounds check before view creation

**File**: `docs/js/app/dicom.js`, lines 343–365
**Severity**: Medium
**Impact**: On JPEG Lossless files where `pixelDataElement.fragments` is absent (unusual but
valid), the manual fallback parses the raw byte array and creates a view:

```js
// dicom.js line 362
frameData = new Uint8Array(byteArray.buffer, byteArray.byteOffset + offset, fragLength);
```

`fragLength` is read from the DICOM byte stream but is never validated against the remaining
buffer before the `Uint8Array` constructor is called. A truncated or malformed file can
produce a `RangeError: offset is outside the bounds of the DataView`, which is caught by the
outer try/catch and rethrown as a staged error — but without the specific bounds information
that would help diagnose the file. More critically, if `byteArray.byteOffset + offset +
fragLength` overflows `byteArray.buffer.byteLength`, the error message will be the browser's
opaque RangeError rather than a meaningful decode diagnostic.

**Recommended fix**: Before constructing the view, add:

```js
const viewStart = byteArray.byteOffset + offset;
const viewEnd = viewStart + fragLength;
if (fragLength <= 0 || viewEnd > byteArray.buffer.byteLength) {
    throw createStagedError(
        'frame-extraction',
        `Encapsulated frame claims ${fragLength} bytes at offset ${offset} but buffer ends at ` +
        `${byteArray.buffer.byteLength - byteArray.byteOffset}.`
    );
}
```

---

### [MEDIUM-2] `getMetadataNumber` tries `int16` before `int32`, potentially truncating 32-bit values

**File**: `docs/js/app/dicom.js`, lines 30–65
**Severity**: Medium
**Impact**: The fallback cascade is: string → `uint16` → `int16` → `uint32` → `int32`. For
DICOM tags stored in a VR that `dicomParser` exposes only via `uint32`/`int32` (e.g. `SL`,
`UL`, or `AT`), the `uint16` call may silently succeed by returning the low 16 bits of a
32-bit value, stopping the cascade before `uint32` is tried.

```js
// dicom.js lines 37–54 — uint16 is tried before uint32
try {
    const uint16Value = dataSet.uint16?.(tag);
    if (Number.isFinite(uint16Value)) {
        return uint16Value;  // ← stops here for any 16-bit-representable 32-bit value
    }
} catch {}
```

In practice, the string path (`getNumber → parseFloat`) catches most numeric tags, so this
truncation only fires when the tag has no string representation (unusual). The most
likely affected tag is `NumberOfFrames` (0028,0008), which is VR `IS` and will always have a
string. The risk is low but the ordering is logically wrong.

**Recommended fix**: Reverse the order: try `uint32`/`int32` before `uint16`/`int16`. Wider
types subsume narrower ones, so the result is always correct.

---

### [LOW-1] `isBlankSlice` and `calculateAutoWindowLevel` sample every 10th pixel; thin features can be missed

**File**: `docs/js/app/dicom.js`, lines 256–303
**Severity**: Low
**Impact**: For images that are mostly uniform but contain thin bright or dark features (needle
tracks in interventional radiology, fine vessel contrast in angiography), all sampled pixels
may fall in the uniform background. The range will appear to be < 1, triggering blank-slice
detection, and the image will be rendered black with no feedback.

This is a documented tradeoff. The blank detection false-positive rate is low for typical CT
and MRI but could affect thin-feature angiography or fluoroscopy.

---

### [LOW-2] `parseDicomMetadata` silently skips files with valid pixel data but zero-valued row/column headers

**File**: `docs/js/app/dicom.js`, lines 103–126
**Severity**: Low
**Impact**: `hasPixelData` is computed as:

```js
hasPixelData: !!pixelDataElement && rows > 0 && cols > 0
```

A malformed DICOM file where `rows` or `cols` is zero (or missing, defaulting to `0`) will
be silently skipped during folder import even if it has renderable pixel data. There is no
user-visible warning; the file simply does not appear in the study list.

---

## 2. Rendering Pipeline

---

### [MEDIUM-3] MONOCHROME1 photometric interpretation is never inverted

**File**: `docs/js/app/rendering.js`, lines 745–765
**Severity**: Medium
**Impact**: DICOM MONOCHROME1 encoding means pixel value 0 = white and maximum value =
black — the opposite of the normal convention. This is common in CR (plain chest X-ray),
DX (digital radiography), and some MG (mammography) files. The rendering loop:

```js
// rendering.js lines 754–758
let pixelValue = decoded.pixelData[i] * decoded.rescaleSlope + decoded.rescaleIntercept;
pixelValue = Math.max(windowMin, Math.min(windowMax, pixelValue));
grayscaleValue = Math.round(((pixelValue - windowMin) / windowDivisor) * 255);
```

maps low values to dark and high values to bright regardless of photometric interpretation.
There is no `if (decoded.photometricInterpretation === 'MONOCHROME1')` check anywhere in the
rendering code. A chest X-ray will show lungs bright white and ribs dark — the radiological
inverse.

No test covers MONOCHROME1, which is why this has gone undetected (see also LOW-12).

**Recommended fix**: After the grayscale value is computed, add:

```js
if (decoded.photometricInterpretation === 'MONOCHROME1') {
    grayscaleValue = 255 - grayscaleValue;
}
```

---

### [MEDIUM-4] RGB rendering branch does not guard against 16-bit channel values

**File**: `docs/js/app/rendering.js`, lines 729–744
**Severity**: Medium
**Impact**: The RGB path writes pixel data directly to the `Uint8ClampedArray` output buffer:

```js
// rendering.js lines 738–742
const interleavedIndex = i * 3;
outputPixels[pixelIndex]     = decoded.pixelData[interleavedIndex];
outputPixels[pixelIndex + 1] = decoded.pixelData[interleavedIndex + 1];
outputPixels[pixelIndex + 2] = decoded.pixelData[interleavedIndex + 2];
```

`Uint8ClampedArray` silently clamps values outside 0–255. If `decoded.pixelData` contains
16-bit channel values (possible when `decodeNative` returns an RGB image with
`bitsAllocated = 16`), values 256–65535 all become 255 and values < 0 become 0. The image
appears nearly solid white or black rather than as a meaningful image.

There is no check that `decoded.bitsAllocated <= 8` before entering the RGB path. The
`validateRenderedPixelData` function (rendering.js lines 218–244) validates that
`samplesPerPixel === 3` and that total sample count matches, but does not validate bit depth
for the RGB path.

**Recommended fix**: Add a normalization step for the RGB path when `bitsAllocated > 8`:

```js
const maxVal = (1 << decoded.bitsAllocated) - 1;
const scale = decoded.bitsAllocated > 8 ? 255 / maxVal : 1;
// ... then:
outputPixels[pixelIndex] = Math.round(decoded.pixelData[interleavedIndex] * scale);
```

---

### [LOW-3] `decodeNative` `skipWindowLevel` heuristic fires for PALETTE COLOR images

**File**: `docs/js/app/rendering.js`, lines 624–627
**Severity**: Low
**Impact**: The native decode path sets:

```js
skipWindowLevel: bitsAllocated <= 8 &&
    samplesPerPixel === 1 &&
    photometricInterpretation !== 'MONOCHROME1' &&
    photometricInterpretation !== 'MONOCHROME2'
```

The intent is to detect 8-bit grayscale images that are already display-ready. However the
condition also matches `PALETTE COLOR` (8-bit palette index images), which require a lookup
table, not direct display. A PALETTE COLOR image processed through this path would show raw
palette indices as linear grayscale.

---

### [LOW-4] W/L display shows stale values when navigating to a blank slice

**File**: `docs/js/app/rendering.js`, lines 699–703; `docs/js/app/tools.js`, lines 314–320
**Severity**: Low
**Impact**: For blank slices, `renderPixels` returns early before updating
`state.baseWindowLevel`:

```js
// rendering.js lines 706–708
if (state.baseWindowLevel.center === null) {
    state.baseWindowLevel = { center: windowCenter, width: windowWidth };
}
```

This guard is skipped for blank slices (the early return happens before it). `updateWLDisplay`
in viewer.js line 54 is called unconditionally after every render. For a blank slice it reads
`state.baseWindowLevel` from the previous non-blank slice and displays those values — making
it appear the blank slice has real W/L values.

---

## 3. State Management

---

### [HIGH-2] `loadSlice` is async with no cancellation: concurrent invocations corrupt canvas state

**File**: `docs/js/app/viewer.js`, lines 29–122
**Severity**: High
**Impact**: `loadSlice` is an `async` function. If the user scrolls rapidly through slices,
multiple invocations are in flight simultaneously. Each invocation independently:

1. Sets `state.currentSliceIndex = index` (line 34)
2. Calls `readSliceBuffer(slice, 'load')` — async network or Tauri IPC
3. Calls `renderDicom(...)` — async JPEG 2000 decode (up to 10s timeout)
4. Writes to the canvas
5. Hides the loading spinner

There is no serial queue, mutex, or generation counter. A fast scroll from slice 10 to slice
20 could result in slice 20 being rendered from cache first, followed by slices 11–19 arriving
from the network and overwriting the canvas in arbitrary order. The spinner is hidden as soon
as any load completes, not when the most-recently-requested load completes.

The preload block (lines 105–116) compounds this by firing additional unguarded async reads
that also call `dicomParser.parseDicom` concurrently with the main load.

```js
// viewer.js lines 33–34 — no check that this is still the desired slice by the time it renders
state.currentSliceIndex = index;
// ... many async awaits later:
const info = await renderDicom(dataSet, wlOverride, slice.frameIndex || 0, slice);
```

**Recommended fix**: Add a generation counter at the top of `loadSlice`:

```js
const generation = ++state.loadGeneration;
// ... after all awaits, before canvas write:
if (generation !== state.loadGeneration) return; // superseded
```

Initialize `state.loadGeneration = 0` in the state object. This discards stale renders
without cancelling in-flight network requests (a more complete fix would use AbortController
for the fetch, but the generation guard alone fixes the visual corruption).

---

### [MEDIUM-5] `reRenderCurrentSlice` silently does nothing when the LRU cache has evicted the current slice

**File**: `docs/js/app/tools.js`, lines 322–335
**Severity**: Medium
**Impact**: `reRenderCurrentSlice` is called on every W/L drag event and on reset. It
looks up the current slice's dataset from the LRU cache:

```js
// tools.js lines 327–330
const cacheKey = app.sources?.getSliceCacheKey?.(slice, state.currentSliceIndex);
const dataSet = state.sliceCache.get(cacheKey);
if (!dataSet) return;  // ← silent no-op
```

If the user navigated through many slices (evicting the current slice from the cache), then
returns to an earlier slice and tries to adjust W/L, nothing happens. The image is frozen at
the last-rendered W/L. There is no user feedback.

The desktop cache holds 24 entries, the web cache holds 100. For a multi-series study (e.g.,
two MRI sequences of 50 slices each), navigating to series 2 and back can evict series 1's
slices from even the web cache. This makes the W/L tool silently non-functional.

**Recommended fix**: On cache miss, trigger a fresh slice load:

```js
if (!dataSet) {
    app.viewer.loadSlice(state.currentSliceIndex);
    return;
}
```

`loadSlice` will re-fetch, re-parse, and re-render with the current `state.windowLevel`
override already set.

---

### [MEDIUM-6] `state.measurements` Map is not cleared when `state.studies` is replaced

**File**: `docs/js/app/tools.js`, lines 370–379; `docs/js/app/main.js`, lines 80–85
**Severity**: Medium
**Impact**: When the user drops a new DICOM folder, `state.studies` is replaced via
`handleDroppedFolder`. This does not clear `state.measurements`. `resetViewForNewSeries` is
called when switching series and does clear measurements, but it is not called during the
library-level study replacement.

DICOM Study Instance UIDs are globally unique in practice, so the probability of a collision
is negligible. However, it represents a state hygiene gap: accumulated measurements from
previous sessions would survive into a new folder load if UIDs somehow collided.

**Recommended fix**: Call `state.measurements.clear()` in `handleDroppedFolder` and
`handleTauriDrop` after `state.studies` is replaced, before calling `displayStudies`.

---

### [MEDIUM-7] `openPanels.seriesPanels` uses a colon-delimited composite key that is fragile

**File**: `docs/js/app/library.js`, lines 23–27, 565–577
**Severity**: Medium
**Impact**: Series panel open/close state is tracked as `"studyUid:seriesUid"` in a flat Set:

```js
// library.js lines 566–567
openPanels.seriesPanels.forEach(key => {
    const [studyUid, seriesUid] = key.split(':');
```

DICOM UIDs must contain only digits and dots per the standard, so colons should never appear.
However, if the application encounters UIDs from non-conformant equipment that includes
unexpected characters, `key.split(':')` would produce more than 2 parts, `studyUid` would be
the first segment only, and `seriesUid` would be the second segment only — neither would match
the actual UID. The panel would fail to re-open silently.

**Recommended fix**: Use a `Map<studyUid, Set<seriesUid>>` structure instead of a flat Set
with a delimiter-encoded key. This is unambiguous and does not require any string escaping.

---

## 4. Memory Management

---

### [MEDIUM-8] JPEG 2000 Web Worker is never terminated on series close or viewer close

**File**: `docs/js/app/dicom.js`, lines 425–432
**Severity**: Medium
**Impact**: `jpeg2000WorkerState.worker` is created lazily on first JPEG 2000 decode request
and then kept alive indefinitely. `disposeJpeg2000Worker()` exists but is only called on
error conditions (lines 473, 495, 534, 574). After the user views a JPEG 2000 series and
returns to the library, the worker and its OpenJPEG WASM module remain allocated.

The WASM heap for OpenJPEG is approximately 50–200MB depending on the WASM build. Keeping it
live while the user browses the library is unnecessary memory pressure.

**Recommended fix**: Call `disposeJpeg2000Worker()` from `closeViewer()` in `viewer.js`. The
worker will be re-created lazily the next time a JPEG 2000 image is loaded.

---

### [MEDIUM-9] `loadSampleStudies` fetches and holds all sample files in memory simultaneously

**File**: `docs/js/app/sources.js`, lines 634–664
**Severity**: Medium
**Impact**: All sample files are fetched in parallel before any are parsed:

```js
// sources.js lines 634–645
const filePromises = fileNames.map(async (name, i) => {
    const res = await fetch(`${samplePath}/${name}`);
    const blob = await res.blob();
    // ...
    return { name, blob };
});
const files = await Promise.all(filePromises);  // all 188 blobs in memory at once
```

For the CT sample (188 slices × ~512KB each) this allocates ~96MB of blob data before the
processing loop begins. The processing loop (lines 652–664) then holds all blobs in memory
while iterating sequentially.

**Recommended fix**: Process in batches of, say, 20 files: fetch 20, parse 20, free 20,
repeat. This caps peak memory at `batch_size × avg_file_size` instead of
`total × avg_file_size`.

---

### [LOW-5] `getAllFileHandles` is unboundedly recursive with no depth limit or cycle detection

**File**: `docs/js/app/sources.js`, lines 216–226
**Severity**: Low
**Impact**: The File System Access API path for browser folder drop uses:

```js
async function getAllFileHandles(dirHandle) {
    const files = [];
    for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file') { files.push({ handle, name }); }
        else if (handle.kind === 'directory') {
            files.push(...await getAllFileHandles(handle));  // ← unbounded recursion
        }
    }
    return files;
}
```

For deeply nested real directory trees, this can overflow the call stack. The File System
Access API does not follow symlinks, so cycles are not possible in practice, but a real
PACS archive organized 15+ levels deep would cause a stack overflow.

The desktop path (`loadStudiesFromDesktopPaths`) correctly uses an iterative stack with
`maxDepth = 20` and a `visited` Set. The File System Access API path should have equivalent
protections.

---

### [LOW-6] Desktop LRU cache of 24 entries is undersized for multi-series navigation

**File**: `docs/js/app/state.js`, line 44
**Severity**: Low
**Impact**: `SLICE_CACHE_MAX_ENTRIES = 24` on desktop. An MRI study with two 20-slice series
(total 40 slices) will cause cache thrashing when switching between series: series 2's slices
immediately start evicting series 1's slices. This is not a correctness issue (re-decoding is
fast via the native decode cache), but it causes unnecessary Tauri IPC round-trips and
contributes to the MEDIUM-5 issue (W/L drag no-op on cache miss).

---

### [LOW-7] `renderPixels` allocates a new `ImageData` on every render, including during W/L drag

**File**: `docs/js/app/rendering.js`, lines 717–721
**Severity**: Low
**Impact**: `ctx.createImageData(decoded.cols, decoded.rows)` allocates a new ~1MB
`Uint8ClampedArray` on every call. During W/L drag (which triggers
`reRenderCurrentSlice → renderDicom → renderPixels` on every `mousemove` event at ~60fps),
this creates 60MB/s of short-lived heap allocations, putting pressure on the GC.

Modern V8 handles this well via minor GC, but on low-end devices it can cause janky W/L
adjustment (frame drops mid-drag).

**Recommended fix**: Cache a single `ImageData` object keyed by `(cols, rows)` and reuse it:

```js
// Reuse buffer if same dimensions
if (!state.cachedImageData ||
    state.cachedImageData.width !== decoded.cols ||
    state.cachedImageData.height !== decoded.rows) {
    state.cachedImageData = ctx.createImageData(decoded.cols, decoded.rows);
}
const imageData = state.cachedImageData;
```

---

## 5. Error Handling

---

### [MEDIUM-10] Test mode blank-slice-skip loop silently swallows per-slice errors

**File**: `docs/js/app/main.js`, lines 135–145
**Severity**: Medium
**Impact**: The blank-slice-skip loop in `initializeTestMode` calls `await loadSlice(...)` in
a for loop:

```js
// main.js lines 135–145
for (let i = 0; i < maxSkip && state.currentSeries; i++) {
    if (state.baseWindowLevel.center !== null) {
        console.log(`Found non-blank slice at index ${state.currentSliceIndex}`);
        break;
    }
    if (state.currentSliceIndex < state.currentSeries.slices.length - 1) {
        await loadSlice(state.currentSliceIndex + 1);
    } else {
        break;
    }
}
```

`loadSlice` only logs errors via `console.error` and never throws. If a test dataset
contains decode errors on every slice, `state.baseWindowLevel.center` is never set (blank
slices and error slices both leave it null), and the loop runs all 50 iterations. Each
iteration triggers a full decode attempt and error log. This produces 50 console errors
during CI test runs and makes it harder to identify genuine test failures.

---

### [MEDIUM-11] `addComment` has a race: server ID update arrives after DOM rebuild

**File**: `docs/js/app/notes-reports.js`, lines 108–137
**Severity**: Medium
**Impact**: The function adds a comment with a `local-XXXX` ID optimistically, then awaits
the server:

```js
// notes-reports.js lines 111–136
const comment = { id: generateLocalCommentId(), text: text.trim(), time: now };
comments.push(comment);
updateCommentListUI(studyUid, seriesUid);  // ← renders with local ID

const saved = await notesApi.addComment(...);
if (saved?.id !== undefined && saved?.id !== null) {
    comment.id = saved.id;  // ← mutates in-place
    updateCommentListUI(studyUid, seriesUid);  // ← re-renders with server ID
}
```

If `displayStudies()` is called during the `await` (e.g., triggered by a library refresh
event), the entire `studiesBody` DOM is rebuilt and the second `updateCommentListUI` call
finds no matching elements to update. The in-memory comment retains its `local-XXXX` ID.
When the user later tries to delete this comment:

```js
// notes-reports.js line 149
if (!String(commentId).startsWith('local-')) {
    await notesApi.deleteComment(studyUid, commentId);
}
```

The server delete is skipped because the ID still starts with `local-`. The comment
persists in the server's database even after the user deletes it from the UI.

---

### [LOW-8] `deleteReport` restores the report to the UI on failure, but does not re-attach event handlers

**File**: `docs/js/app/notes-reports.js`, lines 369–385
**Severity**: Low
**Impact**: On delete failure, the report is spliced back into the array and
`updateReportListUI` is called to re-render it. `updateReportListUI` calls
`attachReportEventHandlers(studyUid)` which re-attaches handlers. This is correct. However,
if the failure happens after the DOM was rebuilt by a concurrent `displayStudies` call, the
re-inserted report element is in `studiesBody` but `attachReportEventHandlers` queries for
elements in `studiesBody` using the study UID — which would find the newly rebuilt DOM. This
path is correct in isolation but fragile in the concurrent rebuild scenario.

---

### [LOW-9] Flask `update_library_config` does not prevent path traversal via `..` in folder input

**File**: `app.py`, lines 711–767
**Severity**: Low
**Impact**: The endpoint accepts the `folder` POST parameter and validates it with:

```python
folder_path = os.path.expanduser(folder_raw)
if not os.path.isdir(folder_path):
    return jsonify({'error': ...}), 400
```

This accepts paths like `~/../../etc`. `os.path.isdir` and `os.access` operate on the
resolved path, so a path traversal would only succeed if the resolved path is a real readable
directory — which means the user would only be scanning directories they have read access to
anyway. In the single-user personal app threat model this is acceptable, but it is worth
noting for any future multi-user deployment.

---

## 6. Browser API Usage

---

### [MEDIUM-12] `readSliceBuffer` for `kind: 'path'` does not check `window.__TAURI__` before accessing it

**File**: `docs/js/app/sources.js`, lines 301–315
**Severity**: Medium
**Impact**: The `path` source case calls `window.__TAURI__.fs.readFile(source.path)` directly:

```js
// sources.js lines 302–314
case 'path': {
    const bytes = await withRetries(
        () => window.__TAURI__.fs.readFile(source.path),
        ...
    );
    return bytes;
}
```

If `window.__TAURI__` is undefined (which should not happen in production desktop mode, but
can happen during integration testing or if the Tauri runtime is slow to initialize),
`window.__TAURI__.fs` throws `TypeError: Cannot read properties of undefined`. This is caught
by `withRetries` and re-thrown after all retry attempts, eventually surfacing as a scan error.
But the error message `Cannot read properties of undefined (reading 'fs')` is unhelpful.

**Recommended fix**: Add a guard at the top of the `path` case:

```js
if (!window.__TAURI__?.fs?.readFile) {
    throw new Error('Desktop file API is not available. Please reopen the app.');
}
```

---

### [LOW-10] `screenToImage` coordinate calculation assumes no CSS `margin` or `border` on the canvas

**File**: `docs/js/app/tools.js`, lines 36–49
**Severity**: Low
**Impact**: The calculation uses `canvas.getBoundingClientRect()` for the canvas position,
which is correct. However, `canvas.width / rect.width` as a scale factor does not account for
CSS `border-box` sizing differences or subpixel rendering. On high-DPI displays, if the
canvas CSS size and physical size differ from the attribute size (e.g., a 512×512 canvas
displayed at 400×400 CSS pixels), the scale factors `scaleX` and `scaleY` will be `512/400 =
1.28`. This is intentional and correct. However, if the canvas has any CSS `padding` or
`border`, `rect.width` would include those and the scale factors would be wrong.

The current CSS does not add padding or border to `#imageCanvas`, so this is not a current
bug. It is a fragile assumption documented here for maintainers.

---

### [LOW-11] `canvas.addEventListener('wheel', ...)` uses `e.preventDefault()` without `{ passive: false }`

**File**: `docs/js/app/main.js`, lines 394–410
**Severity**: Low
**Impact**: Modern browsers require wheel event listeners to be registered with
`{ passive: false }` to allow `preventDefault()`. Without it, Chrome emits a console warning:
"Unable to preventDefault inside passive event listener due to target being treated as
passive." On some browser versions, `preventDefault()` may be silently ignored, meaning the
page would scroll while the user is scrolling through slices.

```js
// main.js lines 394–410
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // ...
});
```

**Recommended fix**:

```js
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    // ...
}, { passive: false });
```

---

## 7. Test Coverage Gaps

---

### [LOW-12] No test for MONOCHROME1 photometric interpretation

MONOCHROME1 inversion (MEDIUM-3) is completely untested. A test should load a CR or DX file
with MONOCHROME1 encoding and assert that the rendered canvas pixel at a known bright-value
location is dark (inverted). The absence of this test is why the inversion bug exists and
has not been caught.

---

### [LOW-13] No test for multi-frame DICOM rendering

`getNumberOfFrames` and `expandFrameSlices` are exercised in code but no Playwright test
verifies that a multi-frame DICOM file is correctly expanded into multiple navigable slices.
The test data directory appears to contain only single-frame MRI slices.

---

### [LOW-14] Desktop native decode fallback path is never exercised in CI

`tests/desktop-native-decode.spec.js` exists but the CI environment does not run a Tauri
instance. The `decodeWithFallback` function (rendering.js lines 638–690) has six distinct
branches (native-first success, native-first fail → JS success, native-first fail → JS fail,
js-first success, js-first fail → native success, js-first fail → native fail) and none of
them are covered in CI.

---

### [LOW-15] No test for the `loadSlice` race condition (HIGH-2)

A regression test for HIGH-2 would scroll through multiple slices rapidly and then verify that
the final displayed slice matches `state.currentSliceIndex`. Currently there is no test that
exercises concurrent `loadSlice` calls.

---

### [LOW-16] No test for W/L drag no-op on cache miss (MEDIUM-5)

The `reRenderCurrentSlice` cache miss path produces a frozen image when the user adjusts
W/L after heavy navigation. A unit test could set `SLICE_CACHE_MAX_ENTRIES = 1`, navigate to
slice 2 (evicting slice 1), navigate back to slice 1, and then verify W/L adjustment still
produces a visible change.

---

### [LOW-17] No test for blank-slice auto-advance in series with error slices

The blank-slice skip loop in `initializeTestMode` is tested indirectly by the normal test
mode startup, but there is no test for a dataset where some slices have decode errors. The
loop would run to `maxSkip = 50` in that case (MEDIUM-10), which could significantly slow
test startup.

---

## 8. Tauri Desktop Integration

---

### [MEDIUM-13] `validate_decode_path` scope check fails on first launch before persisted scope is populated

**File**: `desktop/src-tauri/src/decode.rs`, lines 269–299
**Severity**: Medium
**Impact**: The `tauri-plugin-persisted-scope` plugin populates the Tauri filesystem scope
from a persisted file on disk. On first launch (no persistence file), the scope is empty.
`validate_decode_path` checks:

```rust
// decode.rs lines 288–296
if !app.fs_scope().is_allowed(&canonical_path) {
    return Err(DecodeError::new(
        "decode",
        format!(
            "Decode path is outside the allowed desktop file scope: {}",
            canonical_path.display()
        ),
    ));
}
```

On first launch, no paths are in the scope, so every native decode attempt fails with this
error. The app falls back to JS decode (`decodeWithFallback` in rendering.js), so the user
experience degrades gracefully — but the error message "Decode path is outside the allowed
desktop file scope" is surfaced in the decode error overlay, which is confusing for users who
have just picked their library folder.

**Recommended fix**: After the scope check fails, attempt to add the path's parent directory
to the scope:

```rust
app.fs_scope().allow_directory(canonical_path.parent().unwrap_or(&canonical_path), true)
    .map_err(|e| DecodeError::new("codec-init", format!("Failed to extend scope: {e}")))?;
```

Then retry the scope check. If it still fails, return the error.

---

### [LOW-18] `DesktopLibrary.getRuntime()` and `DesktopDecode.getRuntime()` validate different API surfaces

**File**: `docs/js/app/desktop-library.js`, line 9; `docs/js/app/desktop-decode.js`, lines 67–75
**Severity**: Low
**Impact**: Library runtime validation checks `dialog.open`, `fs.readDir`, and `path.join`.
Decode runtime validation checks `core.invoke`. These are different subsets of the Tauri API.
If one is available but the other is not (e.g., a plugin that loads asynchronously is not yet
ready), one function succeeds while the other throws, producing different error messages for
what is conceptually the same problem ("Tauri not ready").

**Recommended fix**: Consolidate runtime validation into a single `checkDesktopRuntime()`
utility that checks all required APIs and throws a consistent error message.

---

## 9. Flask Backend

---

### [MEDIUM-14] `scan_dicom_folder` crashes with `PermissionError` on unreadable subdirectories

**File**: `app.py`, lines 396–456
**Severity**: Medium
**Impact**: The file discovery step:

```python
# app.py line 404
file_paths = [f for f in folder.rglob('*') if f.is_file()]
```

`Path.rglob('*')` raises `PermissionError` if it encounters a subdirectory it cannot read.
This is common on NAS mounts, network shares, and macOS system directories. The exception
propagates through `scan_dicom_folder` and through `DicomFolderSource.get_data()`, causing
the library endpoint to return a 500 error with no useful message.

`_read_single_dicom` has a broad exception catch, but the rglob itself is not wrapped.

**Recommended fix**:

```python
file_paths = []
for f in folder.rglob('*'):
    try:
        if f.is_file():
            file_paths.append(f)
    except PermissionError:
        app.logger.warning("Skipping unreadable path during library scan: %s", f)
```

Or use `os.walk` with `onerror`:

```python
def on_error(e):
    app.logger.warning("Skipping unreadable directory: %s", e.filename)

file_paths = []
for root, dirs, files in os.walk(folder, onerror=on_error):
    for name in files:
        file_paths.append(Path(root) / name)
```

---

### [MEDIUM-15] `update_library_config` has a double-lock window where global state can be corrupted

**File**: `app.py`, lines 736–766
**Severity**: Medium
**Impact**: The endpoint acquires `LIBRARY_CONFIG_LOCK` twice with a gap in between:

```python
# app.py lines 736–760 (simplified)
with LIBRARY_CONFIG_LOCK:
    source = library_folder_source  # first acquisition

# ... gap: lock is released ...

refreshed = library_source.set_folder(folder_path)  # sets folder internally

with LIBRARY_CONFIG_LOCK:
    library_folder_raw = folder_raw    # second acquisition
    library_folder_source = 'settings'
```

Between the two lock acquisitions, a concurrent POST from a second request could change
`library_folder_raw` and `library_folder_source`. The second acquisition in the first request
would then overwrite those changes with stale values. The two module-level globals would be
out of sync with `library_source.folder_path`.

This requires two concurrent POST requests to `/api/library/config`, which is unlikely in a
single-user app. But the lock structure as written does not actually protect against the race
it appears to guard.

**Recommended fix**: Hold `LIBRARY_CONFIG_LOCK` for the entire operation, or use a single
lock that covers both the `set_folder` call and the global variable updates.

---

### [LOW-19] `migrate_notes` does not validate study UID format

**File**: `app.py`, lines 1218–1293
**Severity**: Low
**Impact**: The migration endpoint accepts arbitrary strings as study UIDs from the
client-provided JSON body. Parameterized queries prevent SQL injection, but malformed UIDs
(e.g., containing spaces, special characters, or very long strings) would persist in the
database and could cause lookup failures downstream. DICOM Study Instance UIDs are at most
64 characters and contain only digits and dots.

**Recommended fix**: Add a validation step:

```python
import re
DICOM_UID_RE = re.compile(r'^[0-9.]{1,64}$')

for study_uid, stored in comments_blob.items():
    if not DICOM_UID_RE.match(study_uid):
        continue  # skip malformed UIDs silently
```

---

### [LOW-20] `scan_dicom_folder` does not deduplicate slices; a file linked from multiple paths would appear twice

**File**: `app.py`, lines 440–447
**Severity**: Low
**Impact**: If a DICOM file is accessible via two paths (hard links on the same filesystem),
`rglob` will encounter it twice and add two entries to `series['slices']`. The study will
show a doubled slice count and the user would navigate through what appears to be duplicate
images.

The client-side scan in `sources.js` handles this via `seenSliceKeys` (a Set of SOP Instance
UIDs). The server-side scan has no equivalent deduplication.

---

## 10. Priority Summary

### Fix immediately — correctness bugs visible to users

| ID | Severity | Description |
|----|----------|-------------|
| HIGH-1 | High | JPEG Baseline color images rendered as grayscale (red channel only) |
| MEDIUM-3 | Medium | MONOCHROME1 images not inverted — chest X-rays display with wrong polarity |
| HIGH-2 | High | Race condition in `loadSlice` — fast navigation displays wrong slice |
| MEDIUM-14 | Medium | `scan_dicom_folder` crashes with `PermissionError` on unreadable subdirectories |

### Fix soon — edge cases, memory, silent failures

| ID | Severity | Description |
|----|----------|-------------|
| MEDIUM-4 | Medium | 16-bit RGB values not normalized before writing to 8-bit canvas |
| MEDIUM-5 | Medium | W/L drag silently does nothing after LRU cache eviction |
| MEDIUM-8 | Medium | JPEG 2000 worker not terminated on series/viewer close |
| MEDIUM-11 | Medium | `addComment` server ID update lost if DOM is rebuilt during await |
| MEDIUM-13 | Medium | Tauri scope check fails on first launch — confusing error to user |
| LOW-11 | Low | Wheel event listener missing `{ passive: false }` — may not prevent page scroll |

### Address in medium term — robustness and test coverage

| ID | Severity | Description |
|----|----------|-------------|
| MEDIUM-9 | Medium | `loadSampleStudies` holds all files in memory simultaneously |
| MEDIUM-15 | Medium | `update_library_config` double-lock race on concurrent POSTs |
| LOW-12 | Low | No test for MONOCHROME1 rendering |
| LOW-13 | Low | No test for multi-frame DICOM |
| LOW-14 | Low | Desktop native decode path untested in CI |
| LOW-15 | Low | No test for concurrent `loadSlice` race condition |
| LOW-17 | Low | No test for blank-slice auto-advance in series with error slices |
| MEDIUM-1 | Medium | Manual encapsulated frame fallback missing bounds check |
| MEDIUM-2 | Medium | `getMetadataNumber` int16 tried before int32 (incorrect ordering) |

---

*End of audit. 37 findings total: 2 High · 15 Medium · 20 Low.*
