# Research Thinking Process

## Methodology

1. **Website analysis**: Fetched easyradiology.de (corporate site) and easyradiology.net (viewer/sharing portal) to understand product positioning and features
2. **Source code inspection**: Analyzed the easyradiology.net page source for technology clues -- found jQuery + Bootstrap, no medical imaging libraries
3. **Multi-source verification**: Cross-referenced company details across GHA (German Health Alliance), Northdata (German business registry), Crunchbase, and the company's own site
4. **Architecture inference**: The absence of any client-side DICOM library (Cornerstone, dicomParser, dcmjs, etc.) strongly suggests server-side DICOM processing with pre-rendered images served to the browser
5. **Market positioning**: Compared against the enterprise PACS vendors already researched (Philips, Sectra, Visage) and open-source alternatives (OHIF) to place easyRadiology in the competitive landscape

## Key Analytical Judgments

### "Not a PACS" Classification
The strongest finding is that easyRadiology is fundamentally a **sharing/workflow tool**, not a viewer or PACS. This distinction matters because it means they're not competing in our space -- they're solving the adjacent problem of getting images from point A to point B. Their "viewer" is minimal by design.

### Server-Side Rendering Inference
Medium confidence. The evidence chain:
- No DICOM/medical imaging JavaScript libraries detected in page source
- jQuery + Bootstrap only -- no WebGL, no canvas-heavy rendering
- "Bandwidth efficient" claim -- pre-rendered JPEGs are smaller than raw DICOM
- Works on all devices including mobile without app -- consistent with serving standard web images
- No WADO or DICOMweb endpoints visible -- proprietary image serving

The alternative explanation (client-side rendering with a custom library not detectable from the landing page) is possible but unlikely given the jQuery/Bootstrap stack.

### Market Share Claim
The 35% German market share claim (from their "who we are" page) should be treated skeptically. It's unclear what "market" they're measuring -- if it's "radiology practices using digital image sharing" the number could be plausible in Germany where CD-based sharing is still common. If it's broader medical imaging market share, the claim is implausible for a ~25-person company with a 2M EUR balance sheet.

### Founding Date Discrepancy
GHA lists 2019, the company website says 2022. Likely the AG (corporation) was registered in 2019 but the product launched commercially in 2022. This is common for German startups that incorporate early for IP/funding purposes.

## Information Gaps

- **Hosting infrastructure**: No information on where data is hosted (AWS, Azure, German cloud, own data centers)
- **Medical device classification**: Not disclosed publicly. The regulatory status affects whether their viewer can be used for diagnostic purposes
- **B2B pricing**: Completely opaque. No public pricing page, case studies, or third-party pricing data
- **API/integration details**: No technical documentation available. The "integrates with any PACS" claim is unverified -- likely uses DICOM C-STORE or folder watching, but details unavailable
- **Viewer capabilities**: Unable to access the actual viewer (requires a valid View Code + patient DOB). The viewer's measurement tools, W/L capabilities, and multi-frame support are unknown

## Confidence Summary

This research provides a solid company overview and product positioning analysis but has limited technical depth. EasyRadiology is not a technically open company -- no public API docs, no open-source components, no conference talks about their architecture. The technical architecture section is largely inferred from indirect evidence.

For a deeper technical analysis, one would need to:
1. Create a test account and inspect the viewer with browser dev tools
2. Attend a product demo and ask technical questions
3. Review their ISO 27001 Statement of Applicability (if available)
4. Check the EU MDR/EUDAMED database for their device classification
