How does Horos (the open-source DICOM viewer for macOS, fork of OsiriX) handle its image library and database?

Specifically:

1. How does Horos store references to DICOM files -- does it copy files into its own database folder or reference them in-place?
2. What happens when you drag-and-drop a folder of DICOM files onto an existing Horos library?
3. How does Horos handle duplicate studies/series when importing?
4. What is the structure of the Horos database folder (DATABASE.noindex, etc.)?
5. Does Horos support multiple library locations or source folders?
6. How does Horos handle the "copy files" vs "reference in place" choice?
7. What is the user experience when importing -- progress indicators, error handling, batch behavior?
8. How does Horos persist the library index across app restarts?
