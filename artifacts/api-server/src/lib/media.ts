import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, albumPhotosTable, assetSourcesTable, photosTable } from "@workspace/db";

export const storageRoot = path.resolve(
  process.env.PHOTO_STORAGE_PATH ?? path.resolve(process.cwd(), "storage")
);

export function mimeTypeForFile(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".3gp": "video/3gpp",
    ".3g2": "video/3gpp2",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
  };

  return mimeTypes[extension] ?? "application/octet-stream";
}

export function isManagedPath(filePath: string) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(storageRoot, resolved);

  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

type SourceResponse = {
  sourceType: string;
  sourceFilename: string;
  importedAt: Date;
};

export function mediaResponse(
  photo: typeof photosTable.$inferSelect,
  albumIds: string[] = [],
  sources: SourceResponse[] = [],
) {
  const base = `/api/photos/${photo.id}`;

  return {
    id: photo.id,
    filename: photo.filename,
    thumbnailUrl: `${base}/thumbnail`,
    mediumUrl: `${base}/medium`,
    originalUrl: `${base}/original`,
    mimeType: photo.mimeType,
    mediaType: photo.mediaType as "photo" | "video",
    fileSize: photo.fileSize,
    width: photo.width,
    height: photo.height,
    captureDate: photo.captureDate,
    captureDateSource: photo.captureDateSource,
    description: photo.description,
    cameraMake: photo.cameraMake,
    cameraModel: photo.cameraModel,
    lensModel: photo.lensModel,
    orientation: photo.orientation,
    duration: photo.duration,
    latitude: photo.latitude == null ? null : Number(photo.latitude),
    longitude: photo.longitude == null ? null : Number(photo.longitude),
    isFavorite: photo.isFavorite,
    isArchived: photo.isArchived,
    isTrashed: photo.isTrashed,
    trashedAt: photo.trashedAt,
    albumIds,
    sources,
  };
}

export async function albumIdsForPhotos(photoIds: string[]) {
  if (!photoIds.length) return new Map<string, string[]>();

  const rows = await db
    .select()
    .from(albumPhotosTable)
    .where(inArray(albumPhotosTable.photoId, photoIds));

  const result = new Map<string, string[]>();

  for (const row of rows) {
    result.set(row.photoId, [
      ...(result.get(row.photoId) ?? []),
      row.albumId,
    ]);
  }

  return result;
}

export async function albumIdsForPhoto(photoId: string) {
  const rows = await db
    .select({ albumId: albumPhotosTable.albumId })
    .from(albumPhotosTable)
    .where(eq(albumPhotosTable.photoId, photoId));

  return rows.map((row) => row.albumId);
}

export async function sourceInfoForPhotos(photoIds: string[]) {
  if (!photoIds.length) {
    return new Map<string, SourceResponse[]>();
  }

  const rows = await db
    .select({
      assetId: assetSourcesTable.assetId,
      sourceType: assetSourcesTable.sourceType,
      sourceFilename: assetSourcesTable.sourceFilename,
      importedAt: assetSourcesTable.importedAt,
    })
    .from(assetSourcesTable)
    .where(inArray(assetSourcesTable.assetId, photoIds));

  const result = new Map<string, SourceResponse[]>();

  for (const row of rows) {
    result.set(row.assetId, [
      ...(result.get(row.assetId) ?? []),
      row,
    ]);
  }

  return result;
}

export async function sourceInfoForPhoto(photoId: string) {
  const result = await sourceInfoForPhotos([photoId]);

  return result.get(photoId) ?? [];
}
