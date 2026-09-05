---
name: Import hardening decisions
description: Production import safety decisions for the unified local photo library.
---

The import engine uses database uniqueness for per-user asset hashes and album names, a bounded worker pool, streamed browser staging, and deterministic hash-based managed filenames. Original copies and thumbnails are written through temporary files and verified before rename; thumbnail failure must not discard a valid original. Folder sources are read-only; browser staging is disposable after a fully successful import.

**Why:** Large Takeout/HDD libraries make application-only duplicate checks, sequential processing, and whole-file browser buffering unsafe or too slow.

**How to apply:** Preserve the shared import pipeline for every source type, keep source provenance separate from the managed asset, and treat failed files as explicit retry candidates rather than silently retrying them on every restart. Keep originals on a configurable host-mounted path in self-hosted Compose deployments.