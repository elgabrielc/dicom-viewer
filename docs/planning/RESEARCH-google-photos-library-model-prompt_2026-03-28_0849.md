# Google Photos: Library Model, Import Pipeline, and Sync Architecture

## 1. Import Pipeline: Copy, Not Reference

Google Photos always copies files to the cloud. It never references originals in place. The local originals remain on the device, untouched. There is no managed library folder on disk -- Google Photos does not reorganize, move, or rename local files.

Upload pipeline:
1. Client computes SHA-256 content hash for deduplication
2. Chunked upload (4-8MB chunks) with resumable sessions (24-48h expiry)
3. Background execution via WorkManager (Android) / NSURLSession (iOS)
4. Server-side async processing: thumbnails, video transcoding, EXIF extraction, ML inference

Two quality tiers: Original (byte-for-byte, counts against quota) and Storage Saver (recompressed to 16MP max, lossy, also counts against quota since June 2021).

## 2. Cloud Is the Source of Truth

The cloud is the canonical store. The local device is a partial, disposable cache.

- **One-way upload**: Photos flow from device to cloud. The cloud does not push originals back down automatically.
- **Metadata syncs bidirectionally**: Album membership, favorites, descriptions, edits sync across devices. Image bytes only flow upward.
- **Device as contributor, not mirror**: Each device contributes its camera roll. No device holds a complete copy of the full cloud library.
- **Local metadata cache**: Complete metadata stored locally in SQLite (< 1KB per photo). Even 100K+ libraries fit in ~100MB of metadata. But image bytes are cloud-only after backup.

## 3. Deduplication

SHA-256 content hash at upload time. Server-side check before storing.

- Exact byte-identical copies: deduplicated (same media item ID returned)
- Rotated, cropped, re-encoded, or re-saved copies: NOT caught (different bytes = different hash)
- No post-upload duplicate detection. No built-in near-duplicate scanning.
- Filename from the first upload is retained for subsequent duplicates.

## 4. Selective Sync / "Free Up Space"

"Free up space" is a one-shot destructive operation: deletes ALL local copies of backed-up photos. Not selective.

- No per-photo or per-album "keep offline" option
- No on-demand virtual filesystem (unlike iCloud Photos or OneDrive)
- Thumbnails and previews remain cached in app storage for browsing
- Full-resolution viewing after "Free up space" requires re-downloading from cloud
- Selective backup (separate feature) controls which device folders get backed up at all

## 5. Multi-Device Sync

Cloud library acts as hub. All devices sync through it, never peer-to-peer.

- Each device uploads its camera roll to the shared cloud library
- Metadata syncs down via change log with monotonic sequence numbers
- Push + poll hybrid: push notifications for connected clients, batch sync on reconnect
- Device B receives metadata push, displays thumbnails from CDN, streams full-resolution on demand
- SQLite union table on device joins cloud metadata and local-only metadata using file hashes

Conflict resolution:
- Metadata edits: last-writer-wins
- Deletions: tombstones synced to other devices
- In-place edits: versioned edit lists (deterministic modification sequences), stale edits rejected

## 6. Offline Access

Limited. Only locally cached thumbnails and previously viewed/downloaded photos are available offline.

- Thumbnails: browsing works offline
- Full-resolution: only if previously viewed or manually downloaded
- Search: requires server-side ML, does not work offline
- Uploads: queued for when connectivity returns
- No "make all photos available offline" bulk option

Google released Gallery Go (now Google Gallery) as a separate 10MB app for offline-first use on Android Go devices -- an acknowledgment that offline is a gap in the main app.

## 7. Storage Structure on Disk

Google Photos does not create its own folder structure. It reads from existing OS folders and maintains a private app cache.

**Android:**
- Reads from DCIM/Camera/, DCIM/Screenshots/, Pictures/, etc.
- App cache: thumbnails, previews, recently viewed media
- SQLite databases for local metadata cache and sync state

**iOS:**
- Reads from Camera Roll via Photos framework
- Sandboxed app container for cache

**Desktop:**
- No native desktop app. Google Drive for Desktop can upload photos from specified folders.
- photos.google.com web interface is the primary desktop access.

**Cloud (server-side):**
```
bucket/user_id/year/month/day/photo_original.jpg
bucket/user_id/year/month/day/photo_thumbnail.jpg
```
Multiple resolutions per photo. Videos at multiple transcodes.

## 8. Picasa to Google Photos Transition

No automated migration path. Google sunset the local tool and told users to re-upload.

- Picasa Web Albums automatically appeared in Google Photos (same Google account)
- Image files on the user's hard drive were preserved (they were always local)
- Lost: folder hierarchy (Google Photos flattens everything), Picasa face tags and edits (not migrated), local organization metadata (.picasa.ini files), original quality (some users reported recompression during upload)
- Google called it "switching," not "migrating"

## 9. Large Libraries (100K+ Items)

### Client-side (Web)
- Justified grid layout using Knuth-Plass line-breaking algorithm (~10ms for 1,000 photos)
- Virtual DOM: never more than ~50 photo elements in DOM regardless of library size
- Section-based metadata loading: initial load sends only section photo counts, not individual metadata
- Multi-resolution progressive loading: full thumbnails nearby, low-res placeholders (889 bytes) further out, CSS-generated grid textures for unloaded sections
- Scroll-aware prefetching with request batching (~10 concurrent, not 100)

### Client-side (Mobile)
- Complete metadata stored locally in SQLite (< 1KB per photo)
- Paged database results: primary grid data loads/unloads with scroll, secondary metadata (dates) stays in memory

### Server-side
- Cursor-based pagination (nextPageToken, max 100 items per request)
- Date-range indexing for efficient time-based queries
- Media URLs expire after 60 minutes (must re-request, not cache)
- Tiered storage: hot (recent, thumbnails), warm (30-90 days), cold (older), archive (very old videos)

## 10. Limitations and Pain Points

1. **Deletion model is confusing**: Deleting from the app deletes both local and cloud. "Delete from device" is buried. Major source of user data loss.

2. **No on-demand files**: Unlike iCloud Photos, no virtual filesystem with placeholders. Binary choice: have the file locally or don't.

3. **No folder/hierarchy support**: Everything flattens into a timeline. No nested albums. Careful folder structures lost on import.

4. **No post-upload dedup**: Only catches byte-identical files at upload time. Near-duplicates accumulate.

5. **Storage Saver is irreversible**: Once recompressed, originals are gone from Google's servers. If local originals also deleted, full-resolution permanently lost.

6. **Minimal offline access**: No bulk offline mode. No "keep this album offline."

7. **Lock-in via ML features**: Search by face, object, location powered by server-side ML. No export of these labels. Switching services means losing organizational intelligence.

8. **API limitations**: No file sizes, no two-way sync, no media modification, strict rate limits, 60-minute URL expiry.

## Key Takeaways for Our Design

1. **Cloud as source of truth works.** Every device contributes; no device is the mirror. This is the model to follow for our cloud mode.

2. **Content hashing at import is essential.** SHA-256 dedup at upload time prevents waste. Already planned in ADR 006.

3. **Complete metadata locally, bytes on demand.** Google Photos keeps < 1KB of metadata per photo in local SQLite. This lets the app browse the full library offline while streaming full-resolution on demand. Directly applicable to our architecture.

4. **Don't replicate Google's deletion confusion.** The "delete means delete everywhere" model is their biggest user complaint. We should have clear separation between "remove from library" and "delete the file."

5. **Flat timeline is a limitation, not a feature.** Google Photos lost folder hierarchy deliberately (simplicity for billions of users). We serve a different audience -- medical imaging users need study/series hierarchy. Our advantage.

6. **Offline access is a differentiator.** Google Photos is weak here. Our copy-on-import model with local managed folder gives us full offline access by default.

7. **The Picasa migration was painful.** No automated path, lost metadata, quality degradation. When we eventually transition from local-only to cloud, we should do better.
