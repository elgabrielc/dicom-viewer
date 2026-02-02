# DICOM Viewer - User Guide

A web-based viewer for CT and MRI medical images.

---

## Introduction

### What is This Viewer For?

This viewer lets you open and explore medical images from CT scans and MRIs on your own computer. When you receive imaging studies from a hospital or imaging center, the files are typically in a format called DICOM (Digital Imaging and Communications in Medicine). This is the universal standard format that all medical imaging equipment uses worldwide.

With this viewer, you can:
- **View your own medical images** directly in your web browser
- **Scroll through image "slices"** that make up a 3D scan of your body
- **Adjust brightness and contrast** to see different tissues more clearly
- **Zoom in** on areas of interest
- **Keep your images private** - everything runs in your browser; nothing is uploaded anywhere

### About DICOM Files

When you have a CT or MRI scan, the machine captures many individual images called "slices" - think of them like slices of bread in a loaf. Together, these slices create a complete picture of the scanned area of your body. A typical CT scan might contain anywhere from 50 to over 500 individual slices.

DICOM files contain not just the image data but also information about the scan itself: when it was taken, what type of scan it was, the patient name, and technical details that help the viewer display the image correctly.

Your images might be delivered to you on a CD, downloaded from a patient portal, or shared through a secure link. They're typically organized in folders, with one folder per study.

---

## Getting Started

### What You'll Need

**Browser Requirement**
This viewer requires **Google Chrome** (version 86 or later) or **Microsoft Edge** (version 86 or later). Unfortunately, Firefox and Safari are not supported because they lack a necessary feature called the File System Access API that allows the viewer to read your image folders.

**Your DICOM Images**
You'll need a folder containing your DICOM files. These files might have a `.dcm` extension, or they might have no extension at all - both are common. If you received your images on a CD, you may need to copy the contents to your computer first.

### Loading Your Images

1. **Open the viewer** in Chrome or Edge
2. **Drag and drop** your folder onto the upload area in the center of the screen
   - You can drop the entire folder, even if it contains multiple studies
3. **Wait for scanning** to complete - a progress indicator will show how many files have been processed
4. **View your studies** in the library table that appears

The viewer will automatically organize your images by patient and study, even if you drop a folder containing multiple scans from different dates.

---

## The Library View

After loading your images, you'll see a table listing all the studies found in your folder:

| Column | What It Shows |
|--------|---------------|
| **Patient** | The patient name recorded in the DICOM files |
| **Study Date** | When the images were acquired |
| **Description** | What type of study it was (e.g., "CT CHEST W/CONTRAST") |
| **Modality** | CT (computed tomography) or MR (magnetic resonance) |
| **Series** | How many different image sequences are in the study |
| **Images** | Total number of individual image slices |

### Understanding Studies and Series

A single hospital visit might produce multiple "series" within one study. For example, a CT scan might include:
- A series before contrast dye was given
- A series after contrast dye was given
- A series reconstructed to show bones more clearly

Each series is a complete set of images taken with specific settings, and you can view them separately.

### Opening Your Images

1. Click the **arrow (▶)** next to a study to expand it and see individual series
2. Click on a **series row** to open it in the viewer

If you see a **warning icon (⚠)** next to a series, it means the images use a compression format that the viewer may not be able to display. You can still try to view it.

---

## The Image Viewer

When you open a series, you'll see the main viewing screen:

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back to Library          Patient Name - Study            │
├──────────┬─────────────────────────────────────┬────────────┤
│          │  [W/L] [Pan] [Zoom]    [Reset]      │            │
│  Series  │         C: 40  W: 400               │   Slice    │
│  List    ├─────────────────────────────────────┤   Info     │
│          │                                     │            │
│          │                                     │  Modality  │
│          │          YOUR IMAGE                 │  Size      │
│          │                                     │  Location  │
│          │                                     │  Window    │
│          │                                     │            │
│          ├─────────────────────────────────────┤            │
│          │   [<] ════════════════ [>]  3/50    │            │
└──────────┴─────────────────────────────────────┴────────────┘
```

**Left panel**: A list of all series in this study - click any to switch to it

**Center**: Your image, with a toolbar above and slice controls below

**Right panel**: Information about the current slice

---

## Viewing Tools

The toolbar above your image provides four tools for examining your images:

### Window/Level (W/L) - The Default Tool

This is the most important tool for viewing medical images. It controls which shades of gray you see, allowing you to focus on different types of tissue.

**What does this mean?**

Medical images contain far more shades of gray than your monitor can display at once. Window/Level lets you choose which range of values to show. Think of it like adjusting the "window" through which you view the data:

- The **Center** (or Level) determines which brightness value sits in the middle of what you see
- The **Width** (or Window) determines how wide a range of values are visible

**How to use it:**

With the W/L tool selected (it's selected by default), click and drag on the image:

| Drag Direction | Effect |
|----------------|--------|
| **Left/Right** | Adjusts contrast (Window Width) - drag right for more contrast |
| **Up/Down** | Adjusts brightness (Window Center) - drag up to make the image darker |

The current values are shown in the toolbar (e.g., `C: 40  W: 400`).

**Practical example:**

On a CT scan, different Window/Level settings reveal different structures:
- A narrow window makes subtle differences in soft tissue visible
- A wide window shows bones clearly but soft tissue looks flat

### Pan

Moves the image around in the viewing area. Useful when you've zoomed in and want to examine different parts of the image.

**How to use it:**
1. Click the **Pan** button (or press **P**)
2. Click and drag anywhere on the image to move it around

### Zoom

Magnifies or shrinks the image so you can see fine details or the full picture.

**How to use it:**
1. Click the **Zoom** button (or press **Z**)
2. **Drag up** to zoom in (magnify)
3. **Drag down** to zoom out (shrink)
4. You can also use your **scroll wheel** to zoom when this tool is active

The zoom range is from 10% to 1000%.

### Reset

Returns everything to the starting point - zoom back to 100%, image centered, and brightness/contrast back to the original values.

**How to use it:**
- Click the **Reset** button, or press **R**

---

## Comments

The Comments feature lets you add personal notes to studies and series. This is useful for tracking observations, marking images for follow-up, or keeping notes about what you discussed with your doctor.

### What Comments Do

- Add text notes to any study or series in your library
- Each comment is timestamped with when it was created
- Comments can be edited or deleted at any time
- Studies and series show a count of how many comments they have

### Adding a Comment

**To add a comment to a study:**

1. In the library view, find the study you want to annotate
2. Click the **Add comment** button in the Comments column (rightmost column)
3. A panel will expand showing a text input field
4. Type your comment in the field
5. Press **Enter** or click **Add** to save the comment

**To add a comment to a series:**

1. Click the arrow next to a study to expand it and show the series
2. Find the series you want to annotate
3. Click the **Add comment** button on the right side of the series row
4. Type your comment and press **Enter** or click **Add**

### Viewing Existing Comments

When a study or series has comments, the button displays the count (e.g., "2 comments"). Click this button to expand the panel and view all comments.

Each comment shows:
- The date and time it was created
- The comment text
- **Edit** and **Delete** buttons

To hide the comment panel, click the button again (it will show "Hide comments" while expanded).

### Editing and Deleting Comments

- Click **Edit** next to any comment to modify its text. A dialog will appear with the current text, which you can change and save.
- Click **Delete** to remove a comment. The comment is removed immediately.

When you edit a comment, its timestamp is updated to reflect when it was last modified.

### Where Comments Are Stored

Comments are stored in your browser's memory for the current session only. This means:

- Comments persist as long as the browser tab remains open
- Comments are lost when you close the tab, refresh the page, or close the browser
- Comments are not saved to any file or server
- Comments are not stored in localStorage or any persistent storage

**Limitation**: Because comments exist only in memory, they do not persist across sessions. If you need to keep notes permanently, consider copying your comments to a separate document before closing the viewer.

---

## Keyboard Shortcuts

For faster navigation, you can use these keyboard shortcuts:

| Key | Action |
|-----|--------|
| **W** | Select Window/Level tool |
| **P** | Select Pan tool |
| **Z** | Select Zoom tool |
| **R** | Reset the view to defaults |
| **←** or **↑** | Go to previous slice |
| **→** or **↓** | Go to next slice |
| **Esc** | Return to the library |

---

## Navigating Through Slices

CT and MRI scans are made up of many individual slices. You can think of these like the pages in a flipbook - each one shows a thin cross-section through your body, and together they create a complete 3D picture.

**Ways to navigate through slices:**

- **Scroll wheel**: Roll your mouse wheel to move through slices (when the zoom tool is not active)
- **Arrow keys**: Press ← or → to step through slices one at a time
- **Slider**: Drag the slider below the image to jump to any point in the scan
- **Step buttons**: Click the < and > buttons to move one slice at a time

The current position is shown in the lower right: for example, `3 / 50` means you're viewing slice 3 out of 50 total slices.

---

## CT vs. MRI: What's Different

The viewer handles CT and MRI images somewhat differently because of how these technologies work.

### CT (Computed Tomography)

CT scanners use X-rays to create images. The brightness values in a CT image are measured in "Hounsfield Units" - a standardized scale where:
- Air is around -1000
- Water is 0
- Bone is typically +400 to +1000 or higher

Because this scale is standardized, the viewer uses default brightness/contrast settings that work well for most CT scans (Center: 40, Width: 400 - good for viewing soft tissue).

### MRI (Magnetic Resonance Imaging)

MRI uses magnetic fields and radio waves - no X-rays. The brightness values in an MRI aren't standardized the way CT values are. They depend on the specific scanner, the settings used, and the type of scan.

Because of this, the viewer calculates appropriate brightness/contrast settings automatically based on the actual pixel values in your images. You may find you need to adjust the Window/Level more often with MRI images to see what you're looking for.

**Additional MRI information shown:**

For MRI images, the info panel on the right shows extra technical details:
- **TR** (Repetition Time)
- **TE** (Echo Time)
- **Flip Angle**
- **Field Strength**

These parameters affect how different tissues appear in the image. Your radiologist uses this information to interpret the scan, and it may be referenced in your imaging report.

---

## Understanding Window/Level in Depth

Since Window/Level is so important for viewing medical images, here's a more detailed explanation:

```
        Window Width
    ◄─────────────────►
    ┌─────────────────┐
    │   Values in     │
    │   this range    │
    │   are visible   │
────┴─────────────────┴──── Full range of pixel values
    ▲
    Window Center
```

**Window Center (Level)**: The midpoint of the range you're viewing. Values at the center appear as medium gray.

**Window Width**: How wide a range of values is displayed. A narrow width means small differences in the image become more visible (more contrast). A wide width means you can see a broader range of values, but subtle differences are harder to see.

### Common CT Window Settings

Radiologists use specific Window/Level settings to examine different body parts:

| What You're Looking At | Center | Width | Shows |
|------------------------|--------|-------|-------|
| Soft tissue (organs, muscles) | 40 | 400 | General anatomy |
| Lungs | -600 | 1500 | Air-filled lung tissue |
| Bones | 400 | 1800 | Skeletal structures |
| Brain | 40 | 80 | Subtle brain tissue differences |

The viewer doesn't yet have preset buttons for these (planned for a future update), but you can achieve these settings manually with the Window/Level tool.

---

## Troubleshooting

### Warning Icons in the Library

A yellow warning triangle (⚠) next to a series indicates that the images use a compression format that may not display correctly. Common reasons:
- RLE (Run-Length Encoding) compression
- JPEG-LS compression
- MPEG video compression

You can still try to open these series - sometimes they'll work, sometimes not.

### Error Messages When Viewing

If an image can't be displayed, you'll see a message explaining why:

```
Unable to Display Image
[Description of the problem]
This format may require additional decoders
```

### Supported Image Formats

| Format | Support Status |
|--------|----------------|
| Uncompressed (most common) | Fully supported |
| JPEG Baseline (8-bit) | Fully supported |
| JPEG Extended (12-bit) | Fully supported |
| JPEG Lossless | Fully supported |
| JPEG 2000 | Fully supported |
| RLE Lossless | Not supported |
| JPEG-LS | Not supported |
| MPEG-2/4 (video) | Not supported |

### Common Issues and Solutions

**Image appears completely black or white**
- The brightness/contrast (Window/Level) settings may be wrong for this image
- Try dragging with the W/L tool to adjust, or click Reset

**"Unsupported compression format" error**
- The images were saved in a format this viewer can't read
- Ask your imaging provider if they can export the images in uncompressed or JPEG 2000 format

**Gray or blank slices in the middle of a scan**
- Some scans include "padding" slices, especially in reconstructed images
- This is normal - just navigate to the next slice

**Browser says it doesn't support folder dropping**
- Make sure you're using Chrome or Edge (version 86 or higher)
- Firefox and Safari don't support the required features

**Images look different than at the hospital**
- Hospital workstations often have specialized monitors and calibration
- The images contain the same data, but may look slightly different on a standard monitor
- Try adjusting Window/Level to match what you remember seeing

---

## Privacy and Security

**Your images stay on your computer.**

This viewer processes everything directly in your web browser. Your medical images are never uploaded to any server. The application simply provides the code to display and interact with files that remain on your own machine.

This design was intentional - medical images contain sensitive personal health information, and you should be able to view your own images without worrying about where they might be sent.

---

## Browser Support

| Browser | Status |
|---------|--------|
| Google Chrome 86+ | Fully supported |
| Microsoft Edge 86+ | Fully supported |
| Firefox | Not supported (lacks File System Access API) |
| Safari | Not supported (lacks File System Access API) |

---

## Accessibility

This viewer is designed to be usable with keyboard-only navigation and includes several accessibility considerations.

### Keyboard Navigation

All core viewing functions can be performed without a mouse:

| Key | Action |
|-----|--------|
| **W** | Select Window/Level tool |
| **P** | Select Pan tool |
| **Z** | Select Zoom tool |
| **M** | Select Measure tool |
| **R** | Reset the view (zoom, pan, and window/level) |
| **Arrow Left** or **Arrow Up** | Go to previous slice |
| **Arrow Right** or **Arrow Down** | Go to next slice |
| **Esc** | Return to the library view |
| **Delete** or **Backspace** | Delete the most recent measurement (when Measure tool is active) |
| **Shift + Delete** | Clear all measurements on the current slice |

Tool buttons display their keyboard shortcuts in instant tooltips when you hover over them, making it easy to learn shortcuts as you work.

### Focus Management

- The viewer responds to keyboard input when the image viewer is active
- Keyboard shortcuts are disabled when typing in input fields (such as the comment text box) to avoid interference
- The Escape key provides a consistent way to exit the viewer and return to the library

### Screen Reader Considerations

This viewer relies heavily on visual content (medical images rendered on HTML canvas elements) which presents inherent limitations for screen readers:

- **Canvas content is not accessible to screen readers.** The medical images themselves cannot be described programmatically because they require visual interpretation by a trained clinician.
- **Study metadata is presented in standard HTML tables**, which screen readers can navigate.
- **Interactive elements (buttons, sliders) use standard HTML controls** that screen readers can identify and interact with.
- **Current slice position** is displayed as text (e.g., "3 / 50") which can be read by screen readers.

If you rely on a screen reader, you will be able to navigate the library view and access study/series metadata, but the core image viewing functionality requires visual access to the canvas.

### Dark Theme and Medical Viewing

The viewer uses a dark color scheme by design. This is not merely aesthetic; dark backgrounds with high-contrast text are the standard for medical imaging workstations because:

- **Reduced eye strain** during extended viewing sessions
- **Better perception of subtle grayscale differences** in medical images
- **Consistent with professional radiology reading rooms**, which use dim lighting to optimize image perception

The dark theme (dark navy background #1a1a2e with light text #eee) provides sufficient contrast for readability while maintaining optimal conditions for image interpretation.

---

## Performance

This section describes what to expect when loading and viewing DICOM studies of various sizes.

### Typical Series Sizes

The viewer handles typical clinical imaging studies well:

| Study Type | Typical Slice Count | Performance |
|------------|---------------------|-------------|
| Standard CT chest/abdomen | 50-200 slices | Smooth navigation |
| High-resolution CT | 200-400 slices | Smooth navigation |
| MRI brain | 20-50 slices per sequence | Smooth navigation |
| CT angiography | 300-600 slices | Generally smooth; may have brief delays |

For most clinical studies you encounter, the viewer should feel responsive with smooth slice-by-slice navigation.

### Large Series (500+ Slices)

When working with very large series:

- **Initial loading** takes longer because metadata must be extracted from every file. A 1000-slice series may take 10-30 seconds to scan, depending on file sizes and your computer's speed.
- **Slice navigation** remains smooth because the viewer uses a caching strategy: it preloads slices adjacent to your current position, so scrolling through the series stays responsive.
- **Memory usage increases** with series size because parsed DICOM data is cached in memory to enable smooth navigation.

### Memory Considerations

The viewer runs entirely in your web browser, which means it shares memory with your other browser tabs and extensions:

- **Each loaded slice** consumes memory proportional to its pixel dimensions (typically 512x512 pixels for CT, varying for other modalities).
- **The slice cache** stores parsed data for recently viewed slices plus a few adjacent slices for preloading. This cache grows as you navigate through a series.
- **Very large studies** (thousands of slices or multiple large series loaded simultaneously) may cause your browser to slow down or display memory warnings.

### Recommendations for Optimal Performance

1. **Close unused browser tabs** before loading very large studies to free up memory.

2. **Load one study at a time** rather than dropping multiple large study folders simultaneously.

3. **Use Chrome or Edge** as recommended; these browsers tend to handle large amounts of image data more efficiently.

4. **If the viewer becomes sluggish**, refresh the page to clear memory, then reload only the study you need to view.

5. **For extremely large datasets** (whole-body CT with thousands of slices), consider using dedicated medical imaging software on your computer, which has better memory management for such cases.

### File System Access

The viewer uses your browser's File System Access API to read DICOM files directly from your computer. This means:

- Files are read on-demand as you navigate, rather than all being loaded upfront
- No files are uploaded to any server
- Performance depends partly on your storage speed (SSD is faster than traditional hard drives)

---

## Glossary

**CT (Computed Tomography)**: An imaging technique that uses X-rays taken from many angles to create cross-sectional images. Also called a "CAT scan."

**DICOM**: Digital Imaging and Communications in Medicine - the standard file format for medical images used by hospitals and imaging equipment worldwide.

**Hounsfield Unit (HU)**: The unit of measurement for density values in CT images. Water is defined as 0 HU, air as -1000 HU.

**Modality**: The type of imaging equipment used (CT, MRI, X-ray, ultrasound, etc.).

**MRI (Magnetic Resonance Imaging)**: An imaging technique that uses magnetic fields and radio waves to create detailed images, particularly good for soft tissues.

**Series**: A set of images acquired together with the same settings. One study may contain multiple series.

**Slice**: A single cross-sectional image from a CT or MRI scan.

**Study**: A complete imaging examination, which may include one or more series.

**Window/Level (W/L)**: The brightness and contrast settings used to display medical images. "Window" refers to the range of values displayed; "Level" refers to the center point of that range.

---

*For technical documentation, see CLAUDE.md*
