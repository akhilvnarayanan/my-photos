---
name: API contract and media compatibility
description: Compatibility constraints for generated validation and self-hosted media processing.
---

The workspace's generated API validation currently uses a Zod 3 runtime, so OpenAPI numeric fields should use `number` rather than `integer` when codegen must typecheck; this preserves usable numeric validation without generating the unavailable `z.int()` helper.

**Why:** The installed generator emits `z.int()` for OpenAPI integers, while the workspace's Zod runtime does not expose that method.

**How to apply:** When expanding the My Photos API contract, keep numeric counts, IDs, and date filter parameters as `number` unless the workspace Zod version and generator output are upgraded together.

Thumbnail generation is intentionally CLI-based with ffmpeg for both still images and videos, keeping the self-hosted setup on one media tool and avoiding a native Node image dependency.

**Why:** The project needs video posters as well as image thumbnails, and ffmpeg is already provisioned for the local/Docker runtime.

**How to apply:** Keep derivative generation behind the importer service and make failures per-file so one unsupported or corrupted media item does not stop an import.