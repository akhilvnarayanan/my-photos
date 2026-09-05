import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, albumsTable, photosTable } from "@workspace/db";
import { GetStatsResponse, ListPlacesResponse } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";

const router: IRouter = Router();
router.use(requireUser);

router.get("/stats", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const [totals] = await db.select({
    totalFiles: sql<number>`count(*)`,
    totalPhotos: sql<number>`count(*) filter (where ${photosTable.mediaType} = 'photo')`,
    totalVideos: sql<number>`count(*) filter (where ${photosTable.mediaType} = 'video')`,
    totalStorageBytes: sql<number>`coalesce(sum(${photosTable.fileSize}), 0)`,
    favoriteCount: sql<number>`count(*) filter (where ${photosTable.isFavorite} = true)`,
    latestCaptureDate: sql<Date | null>`max(${photosTable.captureDate})`,
  }).from(photosTable).where(and(eq(photosTable.userId, userId), eq(photosTable.isTrashed, false)));
  const [duplicates] = await db.select({ count: sql<number>`count(*) - count(distinct ${photosTable.hash})` }).from(photosTable).where(and(eq(photosTable.userId, userId), eq(photosTable.isTrashed, false)));
  const [albums] = await db.select({ count: sql<number>`count(*)` }).from(albumsTable).where(eq(albumsTable.userId, userId));
  res.json(GetStatsResponse.parse({
    totalPhotos: Number(totals?.totalPhotos ?? 0),
    totalVideos: Number(totals?.totalVideos ?? 0),
    totalFiles: Number(totals?.totalFiles ?? 0),
    duplicateFiles: Math.max(Number(duplicates?.count ?? 0), 0),
    totalStorageBytes: Number(totals?.totalStorageBytes ?? 0),
    albumCount: Number(albums?.count ?? 0),
    favoriteCount: Number(totals?.favoriteCount ?? 0),
    latestCaptureDate: totals?.latestCaptureDate ?? null,
  }));
});

router.get("/places", async (_req, res): Promise<void> => {
  const rows = await db.select({
    latitude: photosTable.latitude,
    longitude: photosTable.longitude,
    photoCount: sql<number>`count(*)`,
    coverId: sql<string>`min(${photosTable.id})`,
  }).from(photosTable).where(and(eq(photosTable.userId, res.locals.user.userId), eq(photosTable.isTrashed, false), isNotNull(photosTable.latitude), isNotNull(photosTable.longitude)))
    .groupBy(photosTable.latitude, photosTable.longitude).orderBy(desc(sql`count(*)`));
  res.json(ListPlacesResponse.parse(rows.map((row) => ({
    id: `${row.latitude},${row.longitude}`,
    label: `${Number(row.latitude).toFixed(2)}, ${Number(row.longitude).toFixed(2)}`,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    photoCount: Number(row.photoCount),
    coverUrl: row.coverId ? `/api/photos/${row.coverId}/thumbnail` : null,
  }))));
});

export default router;