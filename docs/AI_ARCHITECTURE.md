# Local AI Architecture

This document defines the privacy-first AI architecture for My Photos.

## Principles

- Original media remains in the existing photo storage.
- AI metadata is derived data and can be deleted/rebuilt without deleting photos.
- AI work is asynchronous and resumable.
- Local processing is the default; external cloud AI is not required.
- Face processing is limited to local face detection and user-managed groups. The application does not automatically assign a real-world identity to a detected face.

## Components

```text
Web UI -> API -> PostgreSQL
             |
             +-> AI job queue -> local AI worker
                                   |- face detection
                                   |- OCR
                                   |- object detection
                                   |- scene classification
                                   `- reverse geocoding/cache
```

The AI worker must be independently scalable and must never be required for normal upload, viewing, albums, favorites, archive, trash, or timeline operations.

## Processing lifecycle

1. Import creates/updates the photo record.
2. A unique AI job is queued for the photo.
3. Worker claims a queued job and records `processing`.
4. Features are processed independently where possible.
5. Derived metadata is written transactionally.
6. Job becomes `completed`, or `failed` with an error and retry count.
7. Reprocessing is allowed when the model version changes or the user requests it.

## Initial database model

- `people`: user-created names/groups and representative photo.
- `photo_faces`: detected face bounding boxes and optional local feature data used only for grouping.
- `ai_tags`: normalized object/scene vocabulary.
- `photo_tags`: photo-to-tag relationships and confidence.
- `photo_text`: OCR output.
- `places`: normalized location information.
- `photo_places`: photo-to-place relationships.
- `ai_jobs`: durable processing queue state.
- `ai_settings`: per-user local AI configuration.

## Search

Natural-language search should first be parsed into structured filters. Examples:

- `Photos of Akhil in Singapore` -> user-labelled person group + place.
- `Photos from 2025` -> capture date range.
- `invoice 12345` -> OCR text search.
- `cars at night` -> object tag + scene/time metadata.

The database remains the source of truth for filtering. A local language/vision model may interpret queries or enrich tags, but should not be required for deterministic metadata filters.

## Scale

The worker must:

- process photos in bounded batches;
- avoid reprocessing unchanged photos/model versions;
- expose queued/processing/completed/failed counts;
- support pause/resume;
- retry transient failures;
- limit concurrency through configuration;
- support CPU-only operation and an optional GPU worker later.

## Places

Existing photo records already contain GPS latitude/longitude. Location enrichment should be asynchronous and cached by normalized coordinates so repeated photos near the same point do not cause repeated reverse-geocoding work.

## Rollout

1. AI schema + queue infrastructure.
2. Places enrichment and Places UI.
3. Local face detection + manually named People.
4. OCR indexing and search.
5. Object/scene recognition.
6. Unified search.
7. Memories/events.
