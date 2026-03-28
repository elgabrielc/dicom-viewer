<!--
  PRINCIPLE: Managed Folder as Local Cache
  Copyright (c) 2026 Divergent Health Technologies
  https://divergent.health/
-->

# Principle: The Managed Folder Is a Local Cache of the Cloud

Two foundational principles for how the local app and cloud service relate:

## 1. The managed folder is a local materialization of the cloud state

The sync engine only talks to the managed folder. It does not need to know about the user's filesystem layout, external drives, source folders, or where files originally came from. On the primary device, the managed folder is the upload source. On a new device, it starts empty and fills as studies are pulled from the cloud.

This decouples sync from filesystem complexity entirely. There is one well-known location to upload from, one well-known location to download into. The import pipeline (drop folder, copy files in, index in SQLite) is a local concern. The sync pipeline (upload bytes, download bytes, reconcile metadata) is a cloud concern. They share the managed folder as their interface boundary.

## 2. Selective sync is a natural consequence

The cloud tracks what studies exist. Each device's managed folder only contains what has been pulled. A user with 200 GB of imaging in the cloud but only 50 GB of disk on their laptop can keep only recent studies locally. There are no phantom references to files that don't exist -- if a study is in the managed folder, its files are there. If it's not, it's cloud-only (browsable via metadata, downloadable on demand).

This avoids the problems of reference-in-place at scale: no offline drive warnings, no broken path references, no ambiguity about what's available locally. The managed folder is always consistent -- everything in it is real and readable.

## Relationship to existing ADRs

- **ADR 006** (Cloud Sync Storage Architecture): defines the sync protocol and metadata layer. This principle defines the file-level interface between local and cloud.
- **ADR 007** (Multi-Source Library): defines how files get into the managed folder (copy on import from dropped folders). This principle defines what happens after they're there.

## Benchmark

This is the Google Photos model. The cloud is the source of truth. Each device contributes via upload and materializes via download. No device holds the complete library unless it chooses to. See [RESEARCH-google-photos-library-model](RESEARCH-google-photos-library-model-prompt_2026-03-28_0849.md) for the full benchmark.
