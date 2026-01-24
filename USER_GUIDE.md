# DICOM CT Viewer - User Guide

## Troubleshooting: Image Display Issues

### Warning Icons in the Library

When browsing your studies, you may see a yellow warning icon (⚠) next to some series. This indicates the series uses a compression format that may not display correctly.

**What it means:** The viewer has detected a transfer syntax (compression format) that is not fully supported. You can still try to view the series - sometimes it may work, other times you'll see an error.

### Error Messages in the Viewer

If an image fails to display, you'll see a message on the canvas:

```
⚠ Unable to Display Image
[Reason for failure]
[Compression format name]
This format may require additional decoders
```

The metadata panel will also show "Decode Error" with the format type.

### Supported Formats

The viewer currently supports these DICOM transfer syntaxes:

| Format | Status |
|--------|--------|
| Uncompressed (Implicit/Explicit VR) | Supported |
| JPEG Baseline (8-bit) | Supported |
| JPEG Extended (12-bit) | Supported |
| JPEG Lossless | Supported |
| JPEG 2000 (Lossless/Lossy) | Supported |
| RLE Lossless | Not Supported |
| JPEG-LS | Not Supported |
| MPEG-2/4 | Not Supported |
| HEVC/H.265 | Not Supported |

### Common Issues and Solutions

**Issue: Black screen with no error message**
- The file may be corrupted or not a valid DICOM file
- Try re-exporting from your PACS or imaging software

**Issue: "Unsupported compression format" error**
- The images use a compression format not yet implemented in this viewer
- Try exporting the images in an uncompressed format or JPEG 2000 from your source system

**Issue: Images look wrong (inverted, noisy, or distorted)**
- The window/level settings may need adjustment
- Some exotic pixel formats may not render correctly

### Getting Help

If you encounter a format that should be supported but isn't working, note the transfer syntax shown in the error message - this helps identify the specific codec needed.
