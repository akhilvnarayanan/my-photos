# My Photos

My Photos is a private, self-hosted photo library for Google Takeout archives. Originals stay on the server's filesystem; PostgreSQL stores searchable metadata, album relationships, favorites, and resumable import progress.

## What works

- Local password-protected login with secure, database-backed sessions
- Recursive Google Takeout, local-folder, and external-drive scanning
- Reviewable scan manifests with file counts, sizes, unsupported-file warnings, and duplicate estimates before copying
- Takeout JSON metadata, EXIF/video metadata, GPS coordinates, camera details, and safe capture-date precedence
- SHA-256 exact duplicate detection without storing a second physical copy
- Source provenance for every imported asset, including duplicate source files
- Local original storage with generated small and medium JPEG derivatives
- Chronological timeline with lazy-loaded thumbnails, search, and photo/video filters
- Full-screen viewer with previous/next, zoom, fullscreen, download, favorite, and keyboard controls
- Album creation, rename, delete, add, and remove flows
- Favorites, GPS-grouped Places, import progress controls, import error history, and library statistics
- Recoverable Trash with restore, permanent deletion, and empty-Trash controls
- Archive and unarchive without removing moments from albums
- Browser uploads for multiple photos/videos with streamed background imports
- Responsive desktop, tablet, and mobile navigation

## Local installation

Requirements: Node.js 24, pnpm, PostgreSQL, and ffmpeg.

```bash
cp .env.example .env
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
```

In a second terminal:

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/my-photos run dev
```

Open `http://localhost:5173`. Set `MY_PHOTOS_USERNAME` and `MY_PHOTOS_PASSWORD` before starting the API. The defaults in `.env.example` are intended for first-run local development only.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `PHOTO_STORAGE_PATH` | Managed filesystem root for originals and thumbnails |
| `MY_PHOTOS_USERNAME` | Local account username |
| `MY_PHOTOS_PASSWORD` | Local account password; it is hashed before storage |
| `PORT` | Port injected into each running service |
| `BASE_PATH` | Vite preview path; use `/` for the standalone app |
| `IMPORT_CONCURRENCY` | Maximum importer workers per job; defaults to 2 and is capped at 8 |
| `MAX_BROWSER_UPLOAD_BYTES` | Maximum size of one streamed browser upload; defaults to 20 GiB |

## Importing Google Takeout

1. Extract the Takeout archive on the same server as My Photos.
2. Sign in and open **Import archive**.
3. Enter the absolute path to the extracted `Google Photos` directory.
4. Start the scan. Nothing is copied yet: My Photos builds a manifest with supported file counts, total size, existing hashes, duplicate estimates, and unsupported-file warnings.
5. Review the manifest and confirm the import. The worker then reads matching JSON sidecars and embedded metadata, uses Takeout → EXIF → media creation → filename → filesystem birthtime → mtime date precedence, hashes every file, and writes progress after each item.
6. Pause, resume, or cancel from the import dashboard. Restarting the server resumes unfinished discovered files, leaves completed records in place, and skips exact duplicates. The source folder is never modified.

## Importing an old HDD or local folder

1. Mount the HDD read-only when possible, or otherwise grant My Photos read access only.
2. Sign in and open **Import archive**.
3. Choose **External drive** or **Local folder**, then enter the absolute path visible to the API server.
4. Start the scan and review the manifest before confirming. The source remains untouched; My Photos copies into `PHOTO_STORAGE_PATH`.
5. Enable folder-to-album creation only when the folder names are meaningful. Generic folders such as `DCIM`, `Backup`, `Pictures`, and `Photos` are ignored.

For browser files, use **Upload**. Multiple files can be selected or dropped into the upload area. Each file is streamed to a temporary local import source, deduplicated against the unified library, and processed in the background.

Photos are stored as:

```text
PHOTO_STORAGE_PATH/
  originals/<year>/<id>.<extension>
  thumbnails/small/<year>/<id>.jpg
  thumbnails/medium/<year>/<id>.jpg
```

The API never exposes this directory as a static public folder. Media is delivered only through authenticated photo routes.

## PostgreSQL

The current workspace uses Drizzle ORM. Push the development schema after changing `lib/db/src/schema/`:

```bash
pnpm --filter @workspace/db run push
```

The main tables are users, sessions, photos, albums, album photos, import jobs, import files, and asset sources. Changes are pushed to the development database without resetting existing records.

## Docker Compose

The included Compose setup runs PostgreSQL, the API, and an nginx-served frontend. PostgreSQL uses a persistent Docker volume, while photo storage is a configurable host bind mount. The API exposes `/api/healthz` for health checks.

```bash
docker compose up --build
```

Then open `http://localhost:8080` and log in with the values configured in `docker-compose.yml` or an override file.

For a real library, copy `.env.example` to `.env`, replace the example credentials, set `PHOTO_STORAGE_HOST_PATH` to a backed-up host directory, and do not keep 190 GB of originals only inside an ephemeral container layer.

## API and frontend development

The API contract lives in `lib/api-spec/openapi.yaml`. After changing it, regenerate the typed React Query client and Zod schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Useful checks:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/my-photos run typecheck
```

## Production builds

```bash
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/my-photos run build
pnpm --filter @workspace/api-server run build
```

On Windows, use a local absolute `PHOTO_STORAGE_PATH` such as `D:\Photos\MyPhotos` and run PostgreSQL, ffmpeg, the API, and the Vite-built frontend as services. On Linux, use a mounted filesystem path such as `/data/photos` and keep the database and photo volume backed up separately.

## Backup and recovery

Back up both the original storage and PostgreSQL. Originals are authoritative; thumbnails can be regenerated. Also preserve the configuration needed to recreate the server, without committing passwords or session secrets.

```bash
pg_dump "$DATABASE_URL" > my-photos.sql
rsync -a --delete "$PHOTO_STORAGE_PATH/" /backup/my-photos-storage/
```

After a restart, unfinished scans and imports are detected from the database and resumed. A partial original copy is verified by size and SHA-256 before reuse. The source HDD or Takeout extraction is never changed by recovery.

## Deliberate non-goals

The MVP does not upload originals to external cloud services and does not include AI search, face recognition, sharing links, cloud sync, photo editing, stories, or automatic memories.