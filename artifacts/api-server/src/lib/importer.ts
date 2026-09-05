import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import ExifReader, { type ExpandedTags } from "exifreader";
import {
  db,
  albumPhotosTable,
  albumsTable,
  assetSourcesTable,
  importFilesTable,
  importJobsTable,
  photosTable,
} from "@workspace/db";
import { logger } from "./logger";
import { storageRoot } from "./media";

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".tif", ".tiff",
  ".bmp", ".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2",
]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);
const RAW_EXTENSIONS = new Set([".cr2", ".cr3", ".nef", ".arw", ".dng", ".raf", ".orf", ".rw2"]);
const GENERIC_ALBUM_NAMES = new Set(["albums", "dcim", "backup", "photos", "pictures", "google photos"]);
const BATCH_SIZE = 250;

type ImportJob = typeof importJobsTable.$inferSelect;
type ImportSourceType = "GOOGLE_TAKEOUT" | "LOCAL_FOLDER" | "EXTERNAL_HDD" | "BROWSER_UPLOAD" | "PHONE";
type TakeoutMetadata = {
  title?: string;
  description?: string;
  photoTakenTime?: { timestamp?: string };
  creationTime?: { timestamp?: string };
  modificationTime?: { timestamp?: string };
  geoData?: { latitude?: number; longitude?: number };
  geoDataExif?: { latitude?: number; longitude?: number };
};
type FileEntry = { source: string; relativePath: string; size: number; modifiedAt: Date };
type ExifMetadata = {
  captureDate?: Date;
  coordinates?: { latitude: number; longitude: number };
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  orientation?: number;
};
type EmbeddedMetadata = {
  captureDate?: Date;
  duration?: number;
  width?: number;
  height?: number;
};

function isSupported(source: string) {
  const extension = path.extname(source).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
}

function mediaTypeFor(source: string) {
  return VIDEO_EXTENSIONS.has(path.extname(source).toLowerCase()) ? "video" : "photo";
}

async function walk(directory: string): Promise<{ supported: FileEntry[]; unsupportedFiles: number }> {
  const supported: FileEntry[] = [];
  let unsupportedFiles = 0;
  const root = path.resolve(directory);
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (isSupported(full)) {
        const stat = await fs.stat(full);
        supported.push({ source: full, relativePath: path.relative(root, full), size: stat.size, modifiedAt: stat.mtime });
      } else if (!entry.name.endsWith(".json")) {
        unsupportedFiles += 1;
      }
    }
  }
  supported.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { supported, unsupportedFiles };
}

async function readMetadata(source: string): Promise<TakeoutMetadata | null> {
  const candidates = [
    `${source}.json`,
    path.join(path.dirname(source), `${path.parse(source).name}.json`),
    `${source}.supplemental-metadata.json`,
    path.join(path.dirname(source), `${path.parse(source).name}.supplemental-metadata.json`),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, "utf8")) as TakeoutMetadata;
    } catch {
      // A sidecar is optional for local folders and older Takeout files.
    }
  }
  return null;
}

function validDate(value: Date | undefined) {
  return value && !Number.isNaN(value.getTime()) ? value : undefined;
}

function dateFromTimestamp(timestamp?: string) {
  if (!timestamp) return undefined;
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) ? validDate(new Date(seconds * 1000)) : undefined;
}

function dateFromExif(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return undefined;
  return validDate(new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`));
}

function dateFromFilename(filename: string) {
  const match = filename.match(/(?:^|[^\d])((?:19|20)\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)(?:[^\d]|$)/);
  if (!match) return undefined;
  return validDate(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function coordinatesFromExif(tags: ExpandedTags) {
  const latitude = tags.gps?.Latitude;
  const longitude = tags.gps?.Longitude;
  return typeof latitude === "number" && typeof longitude === "number"
    ? { latitude, longitude }
    : undefined;
}

function tagText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readExifMetadata(source: string): Promise<ExifMetadata> {
  if (!IMAGE_EXTENSIONS.has(path.extname(source).toLowerCase())) return {};
  try {
    const tags = ExifReader.load(await fs.readFile(source), { expanded: true });
    const exif = tags.exif;
    return {
      captureDate: dateFromExif(exif?.DateTimeOriginal?.description)
        ?? dateFromExif(exif?.DateTimeDigitized?.description)
        ?? dateFromExif(exif?.DateTime?.description),
      coordinates: coordinatesFromExif(tags),
      cameraMake: tagText(exif?.Make?.description),
      cameraModel: tagText(exif?.Model?.description),
      lensModel: tagText(exif?.LensModel?.description),
      orientation: typeof exif?.Orientation?.value === "number" ? exif.Orientation.value : undefined,
    };
  } catch {
    return {};
  }
}

async function readMediaMetadata(source: string): Promise<EmbeddedMetadata> {
  if (!isSupported(source)) return {};
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-select_streams", "v:0",
      "-show_entries", "format=duration:format_tags=creation_time:stream=width,height:duration:tags=creation_time",
      "-of", "json",
      source,
    ]);
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; tags?: { creation_time?: string } };
      streams?: Array<{ width?: number; height?: number; duration?: string; tags?: { creation_time?: string } }>;
    };
    const stream = parsed.streams?.find((item) => item.width || item.height);
    const timestamp = parsed.format?.tags?.creation_time
      ?? parsed.streams?.find((item) => item.tags?.creation_time)?.tags?.creation_time;
    const duration = Number(parsed.format?.duration ?? stream?.duration);
    return {
      captureDate: timestamp ? validDate(new Date(timestamp)) : undefined,
      duration: Number.isFinite(duration) ? Math.round(duration) : undefined,
      width: stream?.width,
      height: stream?.height,
    };
  } catch {
    return {};
  }
}

async function sha256File(source: string) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(source)) hash.update(chunk);
  return hash.digest("hex");
}

async function thumbnail(source: string, destination: string, width: number) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part-${process.pid}-${crypto.randomUUID()}${path.extname(destination)}`;
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-loglevel", "error", "-i", source,
      "-vf", `scale='min(${width},iw)':-2`, "-frames:v", "1", temporary,
    ]);
    const generated = await fs.stat(temporary);
    if (generated.size === 0) throw new Error("ffmpeg created an empty thumbnail");
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function placeholderThumbnail(destination: string, label: string) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part-${process.pid}-${crypto.randomUUID()}`;
  const safeLabel = label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><rect width="640" height="420" fill="#252119"/><text x="320" y="205" text-anchor="middle" fill="#f6f0e7" font-family="sans-serif" font-size="42" font-weight="700">${safeLabel}</text><text x="320" y="250" text-anchor="middle" fill="#c9bdaa" font-family="sans-serif" font-size="18">Original preserved</text></svg>`;
  try {
    await fs.writeFile(temporary, svg, "utf8");
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function takeoutCaptureDate(metadata: TakeoutMetadata | null) {
  return dateFromTimestamp(metadata?.photoTakenTime?.timestamp)
    ?? dateFromTimestamp(metadata?.creationTime?.timestamp)
    ?? dateFromTimestamp(metadata?.modificationTime?.timestamp);
}

function resolveCaptureDate(
  metadata: TakeoutMetadata | null,
  exif: ExifMetadata,
  embedded: EmbeddedMetadata,
  stat: { birthtime: Date; mtime: Date },
  source: string,
  sourceType: ImportSourceType,
) {
  if (sourceType === "GOOGLE_TAKEOUT") {
    const takeout = takeoutCaptureDate(metadata);
    if (takeout) return { date: takeout, source: "TAKEOUT" };
  }
  if (exif.captureDate) return { date: exif.captureDate, source: "EXIF" };
  if (embedded.captureDate) return { date: embedded.captureDate, source: "MEDIA_CREATION" };
  const filenameDate = dateFromFilename(path.basename(source));
  if (filenameDate) return { date: filenameDate, source: "FILENAME" };
  if (sourceType !== "GOOGLE_TAKEOUT" && validDate(stat.birthtime)) return { date: stat.birthtime, source: "FILESYSTEM_BIRTHTIME" };
  return { date: stat.mtime, source: "FILESYSTEM_MTIME" };
}

function albumNamesForPath(relativePath: string, sourceType: ImportSourceType, enabled: boolean) {
  const segments = relativePath.split(/[\\/]/).slice(0, -1).filter(Boolean);
  if (!enabled && sourceType !== "GOOGLE_TAKEOUT") return [];
  if (sourceType === "GOOGLE_TAKEOUT") {
    const albumsIndex = segments.findIndex((segment) => segment.toLowerCase() === "albums");
    return albumsIndex >= 0 ? segments.slice(albumsIndex + 1) : [];
  }
  return segments
    .filter((segment) => !GENERIC_ALBUM_NAMES.has(segment.toLowerCase()))
    .slice(-1);
}

async function existingHash(userId: string, hash: string) {
  const [photo] = await db.select({ id: photosTable.id }).from(photosTable)
    .where(and(eq(photosTable.userId, userId), eq(photosTable.hash, hash))).limit(1);
  return photo;
}

async function getOrCreateAlbum(userId: string, name: string) {
  const [created] = await db.insert(albumsTable).values({ id: crypto.randomUUID(), userId, name })
    .onConflictDoNothing().returning();
  if (created) return created;
  const [existing] = await db.select().from(albumsTable)
    .where(and(eq(albumsTable.userId, userId), eq(albumsTable.name, name))).limit(1);
  if (!existing) throw new Error(`Could not create or find album "${name}"`);
  return existing;
}

async function attachAlbums(userId: string, photoId: string, names: string[]) {
  for (const name of names) {
    const album = await getOrCreateAlbum(userId, name);
    await db.insert(albumPhotosTable).values({ albumId: album.id, photoId }).onConflictDoNothing();
    await db.update(albumsTable).set({ updatedAt: new Date() }).where(eq(albumsTable.id, album.id));
  }
}

async function writeManifest(job: ImportJob, entries: FileEntry[], unsupportedFiles: number) {
  const existing = await db.select({
    id: importFilesTable.id,
    sourcePath: importFilesTable.sourcePath,
    sourceSize: importFilesTable.sourceSize,
    sourceModifiedAt: importFilesTable.sourceModifiedAt,
    sourceHash: importFilesTable.sourceHash,
    status: importFilesTable.status,
  }).from(importFilesTable).where(eq(importFilesTable.importJobId, job.id));
  const existingByPath = new Map(existing.map((row) => [row.sourcePath, row]));
  const hashes = new Set<string>();
  const discovered = [];
  for (const entry of entries) {
    const previous = existingByPath.get(entry.source);
    const unchanged = previous?.sourceHash
      && previous.sourceSize === entry.size
      && previous.sourceModifiedAt?.getTime() === entry.modifiedAt.getTime();
    const digest = unchanged && previous?.sourceHash ? previous.sourceHash : await sha256File(entry.source);
    hashes.add(digest);
    discovered.push({ entry, digest, previous });
  }
  const known = new Set<string>();
  for (const digest of hashes) {
    if (await existingHash(job.userId, digest)) known.add(digest);
  }
  const albumNames = new Set<string>();
  const firstSeen = new Set<string>();
  for (const { entry, digest, previous } of discovered) {
    for (const album of albumNamesForPath(entry.relativePath, job.sourceType as ImportSourceType, job.importFolderStructureAsAlbums)) albumNames.add(album);
    if (previous) {
      await db.update(importFilesTable).set({
        sourceHash: digest,
        sourceSize: entry.size,
        sourceModifiedAt: entry.modifiedAt,
        relativePath: entry.relativePath,
      }).where(eq(importFilesTable.id, previous.id));
    } else {
      await db.insert(importFilesTable).values({
        id: crypto.randomUUID(),
        importJobId: job.id,
        sourcePath: entry.source,
        sourceSize: entry.size,
        sourceModifiedAt: entry.modifiedAt,
        relativePath: entry.relativePath,
        sourceHash: digest,
        status: "discovered",
      });
    }
  }
  const photos = entries.filter((entry) => mediaTypeFor(entry.source) === "photo").length;
  const videos = entries.length - photos;
  const duplicateFiles = discovered.filter(({ digest }) => {
    const repeated = firstSeen.has(digest);
    firstSeen.add(digest);
    return known.has(digest) || repeated;
  }).length;
  const newAssets = hashes.size - [...hashes].filter((digest) => known.has(digest)).length;
  await db.update(importJobsTable).set({
    status: "ready",
    totalFiles: entries.length,
    processedFiles: 0,
    successfulFiles: 0,
    duplicateFiles: 0,
    failedFiles: 0,
    currentFile: null,
    manifestPhotos: photos,
    manifestVideos: videos,
    manifestTotalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    manifestExistingAssets: duplicateFiles,
    manifestNewAssets: newAssets,
    manifestDuplicateFiles: duplicateFiles,
    manifestUnsupportedFiles: unsupportedFiles,
    manifestAlbums: albumNames.size,
    updatedAt: new Date(),
  }).where(eq(importJobsTable.id, job.id));
}

export async function scanImportJob(jobId: string) {
  const [job] = await db.select().from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  if (!job) return;
  try {
    const result = await walk(path.resolve(job.sourcePath));
    await writeManifest(job, result.supported, result.unsupportedFiles);
    logger.info({ jobId, files: result.supported.length }, "Import scan completed");
  } catch (error) {
    await db.update(importJobsTable).set({
      status: "failed",
      errors: [`Cannot scan folder: ${String(error)}`],
      updatedAt: new Date(),
    }).where(eq(importJobsTable.id, jobId));
    logger.warn({ jobId, error }, "Import scan failed");
  }
}

async function waitIfPaused(jobId: string) {
  const [job] = await db.select({ status: importJobsTable.status }).from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  return job?.status === "importing";
}

async function updateProgress(jobId: string, values: Partial<typeof importJobsTable.$inferInsert> | Record<string, unknown>) {
  await db.update(importJobsTable).set({ ...values, updatedAt: new Date() } as any).where(eq(importJobsTable.id, jobId));
}

async function copyOriginalSafely(source: string, destination: string, expectedSize: number, expectedHash: string) {
  try {
    const existing = await fs.stat(destination);
    if (existing.size === expectedSize && await sha256File(destination) === expectedHash) return;
    await fs.rm(destination, { force: true });
  } catch {
    // Destination does not exist yet.
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.copyFile(source, temporary);
    const copied = await fs.stat(temporary);
    if (copied.size !== expectedSize || await sha256File(temporary) !== expectedHash) {
      throw new Error("Copied original failed size or SHA-256 verification");
    }
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function recordImportError(jobId: string, filename: string, error: unknown) {
  const [job] = await db.select({ errors: importJobsTable.errors }).from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  await updateProgress(jobId, {
    processedFiles: sql`${importJobsTable.processedFiles} + 1`,
    failedFiles: sql`${importJobsTable.failedFiles} + 1`,
    currentFile: filename,
    errors: [...(job?.errors ?? []), `${filename}: ${String(error)}`].slice(-100),
  });
}

async function processImportFile(jobId: string, file: typeof importFilesTable.$inferSelect) {
  const [current] = await db.select().from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  if (!current) return;
  try {
    const sourceStat = await fs.stat(file.sourcePath);
    const metadata = await readMetadata(file.sourcePath);
    const exif = await readExifMetadata(file.sourcePath);
    const embedded = await readMediaMetadata(file.sourcePath);
    const capture = resolveCaptureDate(
      metadata,
      exif,
      embedded,
      { birthtime: sourceStat.birthtime, mtime: sourceStat.mtime },
      file.sourcePath,
      current.sourceType as ImportSourceType,
    );
    const digest = file.sourceHash ?? await sha256File(file.sourcePath);
    if (file.sourceHash && (file.sourceSize !== sourceStat.size || file.sourceModifiedAt?.getTime() !== sourceStat.mtime.getTime())) {
      const currentDigest = await sha256File(file.sourcePath);
      if (currentDigest !== file.sourceHash) {
        throw new Error("Source file changed after the scan; rescan the import before retrying");
      }
    }
    const albumNames = albumNamesForPath(file.relativePath ?? path.basename(file.sourcePath), current.sourceType as ImportSourceType, current.importFolderStructureAsAlbums);
    const duplicate = await existingHash(current.userId, digest);
    if (duplicate) {
      await db.insert(assetSourcesTable).values({
        id: crypto.randomUUID(),
        assetId: duplicate.id,
        importJobId: jobId,
        sourceType: current.sourceType,
        sourcePath: file.sourcePath,
        sourceFilename: path.basename(file.sourcePath),
        sourceHash: digest,
      }).onConflictDoNothing();
      await attachAlbums(current.userId, duplicate.id, albumNames);
      await db.update(importFilesTable).set({ sourceHash: digest, status: "duplicate", processedAt: new Date() }).where(eq(importFilesTable.id, file.id));
      await updateProgress(jobId, {
        processedFiles: sql`${importJobsTable.processedFiles} + 1`,
        duplicateFiles: sql`${importJobsTable.duplicateFiles} + 1`,
        currentFile: path.basename(file.sourcePath),
      });
      return;
    }

    const id = crypto.randomUUID();
    const extension = path.extname(file.sourcePath).toLowerCase();
    const mediaType = mediaTypeFor(file.sourcePath);
    const year = capture.date.getUTCFullYear().toString();
    const originalPath = path.join(storageRoot, "originals", year, `${digest}${extension}`);
    const thumbnailExtension = RAW_EXTENSIONS.has(extension) ? ".svg" : ".jpg";
    const smallPath = path.join(storageRoot, "thumbnails", "small", year, `${digest}${thumbnailExtension}`);
    const mediumPath = path.join(storageRoot, "thumbnails", "medium", year, `${digest}${thumbnailExtension}`);
    await copyOriginalSafely(file.sourcePath, originalPath, sourceStat.size, digest);
    let thumbnailPaths: string[] = [smallPath, mediumPath];
    try {
      if (RAW_EXTENSIONS.has(extension)) {
        await Promise.all([
          placeholderThumbnail(smallPath, "RAW"),
          placeholderThumbnail(mediumPath, "RAW"),
        ]);
      } else {
        await Promise.all(thumbnailPaths.map((destination, index) =>
          fs.stat(destination)
            .then((existing) => existing.size > 0 ? undefined : thumbnail(file.sourcePath, destination, index === 0 ? 260 : 1100))
            .catch(() => thumbnail(file.sourcePath, destination, index === 0 ? 260 : 1100))));
      }
    } catch (thumbnailError) {
      thumbnailPaths = [];
      await Promise.all([smallPath, mediumPath].map((filePath) => fs.rm(filePath, { force: true })));
      logger.warn({ jobId, source: file.sourcePath, error: thumbnailError }, "Thumbnail generation failed; preserving original");
    }
    try {
      const coordinates = [metadata?.geoData, metadata?.geoDataExif, exif.coordinates].find((value) =>
        value && typeof value.latitude === "number" && typeof value.longitude === "number"
          && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
          && (value.latitude !== 0 || value.longitude !== 0),
      ) ?? metadata?.geoData ?? metadata?.geoDataExif ?? exif.coordinates;
      const [inserted] = await db.insert(photosTable).values({
        id,
        userId: current.userId,
        filename: metadata?.title || path.basename(file.sourcePath),
        originalPath,
        thumbnailSmallPath: thumbnailPaths.length ? smallPath : null,
        thumbnailMediumPath: thumbnailPaths.length ? mediumPath : null,
        mimeType: mediaType === "video" ? `video/${extension.slice(1)}` : `image/${extension === ".jpg" ? "jpeg" : extension.slice(1)}`,
        mediaType,
        fileSize: sourceStat.size,
        width: embedded.width ?? null,
        height: embedded.height ?? null,
        captureDate: capture.date,
        captureDateSource: capture.source,
        latitude: coordinates?.latitude?.toString() ?? null,
        longitude: coordinates?.longitude?.toString() ?? null,
        hash: digest,
        description: metadata?.description ?? null,
        cameraMake: exif.cameraMake ?? null,
        cameraModel: exif.cameraModel ?? null,
        lensModel: exif.lensModel ?? null,
        orientation: exif.orientation ?? null,
        duration: embedded.duration ?? null,
      }).onConflictDoNothing({ target: [photosTable.userId, photosTable.hash] }).returning();
      if (!inserted) {
        const reused = await existingHash(current.userId, digest);
        if (!reused) throw new Error("Asset was rejected as a duplicate but could not be found");
        await db.insert(assetSourcesTable).values({
          id: crypto.randomUUID(),
          assetId: reused.id,
          importJobId: jobId,
          sourceType: current.sourceType,
          sourcePath: file.sourcePath,
          sourceFilename: path.basename(file.sourcePath),
          sourceHash: digest,
        }).onConflictDoNothing();
        await attachAlbums(current.userId, reused.id, albumNames);
        await db.update(importFilesTable).set({ sourceHash: digest, status: "duplicate", processedAt: new Date() }).where(eq(importFilesTable.id, file.id));
        await updateProgress(jobId, {
          processedFiles: sql`${importJobsTable.processedFiles} + 1`,
          duplicateFiles: sql`${importJobsTable.duplicateFiles} + 1`,
          currentFile: path.basename(file.sourcePath),
        });
        return;
      }
      await db.insert(assetSourcesTable).values({
        id: crypto.randomUUID(),
        assetId: inserted.id,
        importJobId: jobId,
        sourceType: current.sourceType,
        sourcePath: file.sourcePath,
        sourceFilename: path.basename(file.sourcePath),
        sourceHash: digest,
      }).onConflictDoNothing();
      await attachAlbums(current.userId, inserted.id, albumNames);
      await db.update(importFilesTable).set({ destinationPath: inserted.originalPath, sourceHash: digest, status: "completed", processedAt: new Date() }).where(eq(importFilesTable.id, file.id));
      await updateProgress(jobId, {
        processedFiles: sql`${importJobsTable.processedFiles} + 1`,
        successfulFiles: sql`${importJobsTable.successfulFiles} + 1`,
        currentFile: path.basename(file.sourcePath),
      });
    } catch (error) {
      await Promise.all([smallPath, mediumPath].map((filePath) => fs.rm(filePath, { force: true })));
      throw error;
    }
  } catch (error) {
    await db.update(importFilesTable).set({ status: "failed", error: String(error), processedAt: new Date() }).where(eq(importFilesTable.id, file.id));
    await recordImportError(jobId, path.basename(file.sourcePath), error);
    logger.warn({ jobId, source: file.sourcePath, error }, "Import file failed");
  }
}

const activeImportJobs = new Set<string>();

export async function runImportJob(jobId: string) {
  if (activeImportJobs.has(jobId)) return;
  const [job] = await db.select().from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  if (!job || !["importing", "paused"].includes(job.status)) return;
  activeImportJobs.add(jobId);
  try {
    const discovered = await db.select().from(importFilesTable)
      .where(and(eq(importFilesTable.importJobId, jobId), eq(importFilesTable.status, "discovered")))
      .orderBy(desc(importFilesTable.sourcePath));
    let nextIndex = 0;
    const configured = Number(process.env.IMPORT_CONCURRENCY ?? 2);
    const concurrency = Number.isFinite(configured) ? Math.max(1, Math.min(8, Math.floor(configured))) : 2;
    const worker = async () => {
      while (true) {
        const file = discovered[nextIndex++];
        if (!file || !(await waitIfPaused(jobId))) return;
        await processImportFile(jobId, file);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, discovered.length) }, worker));
    const [finished] = await db.select().from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
    if (finished && finished.status === "importing" && finished.processedFiles >= finished.totalFiles) {
      await updateProgress(jobId, { status: "completed" });
      if (finished.sourceType === "BROWSER_UPLOAD" && finished.failedFiles === 0) {
        await fs.rm(finished.sourcePath, { recursive: true, force: true });
      }
    }
    logger.info({ jobId, concurrency }, "Import completed");
  } finally {
    activeImportJobs.delete(jobId);
  }
}