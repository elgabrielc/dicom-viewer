How does Google Photos handle its library model, import pipeline, and sync architecture?

Specifically:

1. What happens when a user imports photos/videos -- are originals copied into a managed location or referenced in place?
2. How does Google Photos handle the local storage vs cloud storage relationship? Is the local library a cache of the cloud, or is the cloud a backup of local?
3. How does deduplication work -- at import time, during sync, or both? What identifiers are used (content hash, metadata, etc.)?
4. How does selective sync / "free up space" work -- how does a device keep a partial local copy of the full cloud library?
5. How does multi-device sync work -- what happens when you import on Device A and want to access on Device B?
6. How does Google Photos handle offline access -- what's available when there's no internet?
7. What is the folder/storage structure on disk (Android, iOS, desktop)?
8. How does Google Photos handle the transition from "local photo library" to "cloud-synced library" -- what was the migration path from local-only tools like Picasa?
9. How does Google Photos handle large libraries (100K+ items) -- any pagination, lazy loading, or tiered storage?
10. What are the known limitations or pain points of the Google Photos model that we should learn from?
