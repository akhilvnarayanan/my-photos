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
import { enqueueAiJob } from "./ai-jobs";

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
      } else {
        unsupportedFiles += 1;
      }
    }
  }
  return { supported, unsupportedFiles };
}

async function sha256File(filePath: string) {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function readMetadata(filePath: string): Promise<TakeoutMetadata | undefined> {
  const metadataPath = `${filePath}.json`;
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(raw) as TakeoutMetadata;
  } catch {
    return undefined;
  }
}

function timestampDate(value?: string) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function resolveCaptureDate(metadata: TakeoutMetadata | undefined, exif: ExifMetadata, embedded: EmbeddedMetadata, filesystem: { birthtime: Date; mtime: Date }, _sourcePath: string, _sourceType: ImportSourceType) {
  const date = timestampDate(metadata?.photoTakenTime?.timestamp)
    ?? timestampDate(metadata?.creationTime?.timestamp)
    ?? exif.captureDate
    ?? timestampDate(metadata?.modificationTime?.timestamp)
    ?? embedded.captureDate
    ?? filesystem.birthtime
    ?? filesystem.mtime;
  return { date, source: metadata?.photoTakenTime?.timestamp ? "TAKEOUT" : exif.captureDate ? "EXIF" : "FILESYSTEM" };
}

async function readExifMetadata(_filePath: string): Promise<ExifMetadata> {
  return {};
}

async function readMediaMetadata(_filePath: string): Promise<EmbeddedMetadata> {
  return {};
}

async function existingHash(userId: string, hash: string) {
  const [row] = await db.select().from(photosTable).where(and(eq(photosTable.userId, userId), eq(photosTable.hash, hash))).limit(1);
  return row ?? null;
}

async function copyOriginalSafely(source: string, destination: string, expectedSize: number, expectedHash: string) {
  try {
    const existing = await fs.stat(destination);
    if (existing.size === expectedSize && await sha256File(destination) === expectedHash) return;
  } catch {}
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.copyFile(source, temporary);
    const copied = await fs.stat(temporary);
    if (copied.size !== expectedSize || await sha256File(temporary) !== expectedHash) throw new Error("Copied original failed size or SHA-256 verification");
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function updateProgress(jobId: string, patch: Record<string, unknown>) {
  await db.update(importJobsTable).set(patch as never).where(eq(importJobsTable.id, jobId));
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

async function attachAlbums(_userId: string, _assetId: string, _albumNames: string[]) {}
function albumNamesForPath(relativePath: string, _sourceType: ImportSourceType, enabled: boolean) { return enabled ? [path.dirname(relativePath)].filter((x) => x && x !== ".") : []; }
async function thumbnail(_source: string, _destination: string, _size: number) {}
async function placeholderThumbnail(_destination: string, _label: string) {}
async function waitIfPaused(_jobId: string) { return true; }

async function processImportFile(jobId: string, file: typeof importFilesTable.$inferSelect) {
  const [current] = await db.select().from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  if (!current) return;
  try {
    const sourceStat = await fs.stat(file.sourcePath);
    const metadata = await readMetadata(file.sourcePath);
    const exif = await readExifMetadata(file.sourcePath);
    const embedded = await readMediaMetadata(file.sourcePath);
    const capture = resolveCaptureDate(metadata, exif, embedded, { birthtime: sourceStat.birthtime, mtime: sourceStat.mtime }, file.sourcePath, current.sourceType as ImportSourceType);
    const digest = file.sourceHash ?? await sha256File(file.sourcePath);
    const albumNames = albumNamesForPath(file.relativePath ?? path.basename(file.sourcePath), current.sourceType as ImportSourceType, current.importFolderStructureAsAlbums);
    const duplicate = await existingHash(current.userId, digest);
    if (duplicate) {
      await enqueueAiJob(current.userId, duplicate.id);
      await db.update(importFilesTable).set({ sourceHash: digest, status: "duplicate", processedAt: new Date() }).where(eq(importFilesTable.id, file.id));
      await updateProgress(jobId, { processedFiles: sql`${importJobsTable.processedFiles} + 1`, duplicateFiles: sql`${importJobsTable.duplicateFiles} + 1`, currentFile: path.basename(file.sourcePath) });
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
        await Promise.all([placeholderThumbnail(smallPath, "RAW"), placeholderThumbnail(mediumPath, "RAW")]);
      } else {
        await Promise.all(thumbnailPaths.map((destination, index) => thumbnail(file.sourcePath, destination, index === 0 ? 260 : 1100)));
      }
    } catch (thumbnailError) {
      thumbnailPaths = [];
      await Promise.all([smallPath, mediumPath].map((filePath) => fs.rm(filePath, { force: true })));
      logger.warn({ jobId, source: file.sourcePath, error: thumbnailError }, "Thumbnail generation failed; preserving original");
    }
    try {
      const coordinates = [metadata?.geoData, metadata?.geoDataExif, exif.coordinates].find((value) => value && typeof value.latitude === "number" && typeof value.longitude === "number") ?? metadata?.geoData ?? metadata?.geoDataExif ?? exif.coordinates;
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
        await enqueueAiJob(current.userId, reused.id);
        await db.update(importFilesTable).set({ sourceHash: digest, status: "duplicate", processedAt: new Date() }).where(eq(importFilesTable.id, file.id));
        await updateProgress(jobId, { processedFiles: sql`${importJobsTable.processedFiles} + 1`, duplicateFiles: sql`${importJobsTable.duplicateFiles} + 1`, currentFile: path.basename(file.sourcePath) });
        return;
      }
      await db.insert(assetSourcesTable).values({ id: crypto.randomUUID(), assetId: inserted.id, importJobId: jobId, sourceType: current.sourceType, sourcePath: file.sourcePath, sourceFilename: path.basename(file.sourcePath), sourceHash: digest }).onConflictDoNothing();
      await attachAlbums(current.userId, inserted.id, albumNames);
      await enqueueAiJob(current.userId, inserted.id);
      await db.update(importFilesTable).set({ destinationPath: inserted.originalPath, sourceHash: digest, status: "completed", processedAt: new Date() }).where(eq(importFilesTable.id, file.id));
      await updateProgress(jobId, { processedFiles: sql`${importJobsTable.processedFiles} + 1`, successfulFiles: sql`${importJobsTable.successfulFiles} + 1`, currentFile: path.basename(file.sourcePath) });
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
    const discovered = await db.select().from(importFilesTable).where(and(eq(importFilesTable.importJobId, jobId), eq(importFilesTable.status, "discovered"))).orderBy(desc(importFilesTable.sourcePath));
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
      if (finished.sourceType === "BROWSER_UPLOAD" && finished.failedFiles === 0) await fs.rm(finished.sourcePath, { recursive: true, force: true });
    }
    logger.info({ jobId, concurrency }, "Import completed");
  } finally {
    activeImportJobs.delete(jobId);
  }
}
