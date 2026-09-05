# My Photos Import Guide

This guide describes the safe workflow for the three supported input paths. My Photos copies or streams into its managed storage; it never renames, moves, deletes, or overwrites the source files.

## Before any import

1. Confirm PostgreSQL and the API are running.
2. Confirm `PHOTO_STORAGE_PATH` is on persistent storage with enough room for originals and derivatives.
3. Keep a backup of the source archive/HDD and database. Do not use the application as the only backup.
4. Start with a small fixture or a representative folder. Do not point the first test at the complete Takeout collection.

## Google Takeout

1. Extract every Takeout ZIP part into one directory on the same server as the API.
2. Open **Import archive** and choose **Google Takeout**.
3. Enter the extracted `Google Photos` directory, not a browser-local path.
4. Choose whether Takeout album folders should be represented as albums.
5. Click **Scan for review**. No managed originals are copied during scanning.
6. Review supported files, total size, existing assets, duplicates, unsupported files, and possible albums.
7. Click **Confirm import**.

Takeout JSON metadata is preferred for capture time and GPS, followed by EXIF and embedded media metadata. Exact SHA-256 duplicates become one asset while every known source and missing album relationship is retained.

## Old HDD or local folder

1. Mount the HDD read-only where possible.
2. Choose **External drive** or **Local folder**.
3. Enter the absolute server-visible directory path.
4. Decide whether meaningful folders should become albums.
5. Scan and review the manifest.
6. Confirm only after checking the discovered counts and storage estimate.

The source remains in place. If a file is already present in the unified library, My Photos records the new source and does not copy a second original.

## Browser uploads

1. Open **Upload**.
2. Select multiple image/video files or drop them onto the upload area.
3. Click **Start upload**.
4. Leave the browser open until files are accepted; the import itself continues on the server.

Browser uploads use the same hash, metadata, thumbnail, album, and source-provenance pipeline. The temporary upload source is local to the managed storage and is not exposed as a public directory.

## Recovery and retry

- **Pause** stops workers from taking new files; a current file may finish.
- **Resume** continues discovered files.
- **Retry failed** requeues only failed files.
- A server restart resumes unfinished discovered work and skips completed files.
- Corrupt or unsupported media is reported per file and does not stop the whole job.

## Verification checklist

After a fixture import, verify:

- Repeating the same import creates no second asset.
- Same bytes with a different filename reuse the asset.
- Same filename with different bytes creates separate assets.
- A Takeout duplicate in multiple album folders appears once but belongs to every album.
- EXIF date/GPS and Takeout sidecar metadata appear in details.
- Videos have a playable managed original and poster thumbnail.
- Trash, restore, archive, unarchive, and search do not touch source files.