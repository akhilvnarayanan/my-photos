# My Photos

My Photos is a private, self-hosted Google Takeout photo library with local originals, searchable metadata, albums, favorites, and resumable imports.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/my-photos` — React + Vite application and visual system
- `artifacts/api-server` — Express API, local sessions, import worker, and protected media routes
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `lib/api-client-react` and `lib/api-zod` — generated client hooks and validation schemas
- `lib/db/src/schema` — Drizzle PostgreSQL schema
- `README.md` and `docker-compose.yml` — local and self-hosted operation

## Architecture decisions

- Original binaries are stored on the filesystem; PostgreSQL stores metadata, relationships, hashes, and import progress.
- Sessions are opaque, database-backed cookies; passwords are hashed with Node's built-in scrypt.
- Imports are scan-first and confirmation-gated; progress is persisted per job and per file so a stopped import can resume without duplicating exact files.
- Every managed asset keeps source provenance, and deletion is a soft move to Trash until the user explicitly purges it.
- Database uniqueness is enforced for `(user_id, hash)` assets and `(user_id, name)` albums; importer conflicts reuse the existing record.
- Browser uploads stream into a temporary managed source and then use the same hash, metadata, and thumbnail pipeline as folder imports.
- The UI uses generated React Query hooks from the OpenAPI contract rather than handwritten client types.
- ffmpeg is used as the thumbnail/poster engine so the self-hosted setup has one media-processing dependency for images and videos.

## Product

- Browse a chronological photo/video timeline with lazy thumbnails and search
- Open a protected viewer with navigation, zoom, fullscreen, download, favorite, and album actions
- Manage albums and favorites, browse GPS-grouped Places, and view library statistics
- Import Google Takeout, local folders, and external drives recursively with a scan manifest, metadata parsing, duplicate detection, thumbnails, pause/resume/cancel, and error history
- Upload multiple browser files into background imports without exposing the upload staging directory
- Archive moments without removing them from albums, and recover or permanently purge items through Trash
- Keep the entire library local with configurable storage and Docker Compose support

## User preferences

The user asked for a real MVP and explicitly does not want AI features or external cloud photo storage.

## Gotchas

- The import form expects a filesystem path visible to the API server, not a browser-local path.
- Import scans are read-only against the source folder; the user must explicitly confirm a manifest before managed copies are created.
- `IMPORT_CONCURRENCY` controls the bounded worker pool (default 2, maximum 8); `MAX_BROWSER_UPLOAD_BYTES` controls one streamed browser upload.
- Run `pnpm --filter @workspace/db run push` after schema changes in development.
- Run `pnpm --filter @workspace/api-spec run codegen` after OpenAPI changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
