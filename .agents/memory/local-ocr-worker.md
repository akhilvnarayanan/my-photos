---
name: Local OCR worker
description: Durable constraints for the local Tesseract queue and Docker worker split.
---

Raw PostgreSQL job-claim queries must explicitly map snake_case columns to the camelCase record shape before passing jobs to Drizzle helpers; type assertions do not perform that conversion.

**Why:** The worker could claim and process a job but then persisted empty photo and user IDs until the boundary mapping was made explicit.

Queued jobs at the maximum attempt count must be transitioned to failed during recovery, while an explicit retry must reset attempts to zero.

**Why:** Requeueing an exhausted job without resetting attempts creates a queued job that no worker is allowed to claim.

The dedicated Docker worker is worker-only and must not have an HTTP healthcheck; only the API service exposes the health endpoint.

**Why:** The worker intentionally starts without PORT and has no web server to answer a healthcheck.

Permanent photo deletion and empty-trash cleanup must remove the corresponding OCR rows as well as media and album/source records.

**Why:** OCR persistence is intentionally independent from the media table, so it will otherwise leave orphaned searchable text behind.

**How to apply:** Preserve these invariants when changing claim SQL, retry/recovery behavior, or Compose service wiring.