import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db, albumPhotosTable, assetSourcesTable, photosTable } from "@workspace/db";
import { DeletePhotoParams, DownloadPhotoParams, GetPhotoParams, ListPhotosQueryParams, ListPhotosResponse, PermanentlyDeletePhotoParams, RestorePhotoParams, RestorePhotoResponse, ToggleArchiveBody, ToggleArchiveParams, ToggleArchiveResponse, ToggleFavoriteBody, ToggleFavoriteParams, ToggleFavoriteResponse } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";
import { albumIdsForPhoto, albumIdsForPhotos, isManagedPath, mediaResponse, sourceInfoForPhoto, sourceInfoForPhotos } from "../lib/media";
import { promises as fs } from "node:fs";

const router: IRouter = Router();
router.use("/photos", requireUser);

router.get("/photos", async (req, res): Promise<void> => {
  const parsed = ListPhotosQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const query = parsed.data;
  const userId = res.locals.user.userId as string;
  const filters = [eq(photosTable.userId, userId)];
  if (query.query) {
    const search = `%${query.query}%`;
    const searchFilter = or(
      ilike(photosTable.filename, search),
      ilike(photosTable.description, search),
      ilike(photosTable.cameraMake, search),
      ilike(photosTable.cameraModel, search),
      sql`exists (select 1 from albums where albums.id in (select album_id from album_photos where album_photos.photo_id = ${photosTable.id}) and albums.user_id = ${userId} and albums.name ilike ${search})`,
    );
    if (searchFilter) filters.push(searchFilter);
  }
  if (query.mediaType !== "all") filters.push(eq(photosTable.mediaType, query.mediaType));
  if (query.favorite !== undefined) filters.push(eq(photosTable.isFavorite, query.favorite));
  filters.push(eq(photosTable.isTrashed, query.trashed ?? false));
  if (query.archived !== undefined) {
    filters.push(eq(photosTable.isArchived, query.archived));
  } else if (query.trashed !== true) {
    filters.push(eq(photosTable.isArchived, false));
  }
  if (query.sourceType) {
    filters.push(sql`exists (select 1 from asset_sources where asset_sources.asset_id = ${photosTable.id} and asset_sources.source_type = ${query.sourceType})`);
  }
  if (query.year) {
    filters.push(gte(photosTable.captureDate, new Date(Date.UTC(query.year, (query.month ?? 1) - 1, 1))));
    filters.push(lt(photosTable.captureDate, query.month
      ? new Date(Date.UTC(query.year, query.month, 1))
      : new Date(Date.UTC(query.year + 1, 0, 1))));
  }
  if (query.from) filters.push(gte(photosTable.captureDate, query.from));
  if (query.to) filters.push(lte(photosTable.captureDate, query.to));
  const countFilters = [...filters];
  if (query.cursor) {
    const [cursorDateText, cursorId] = query.cursor.split("|");
    const cursorDate = new Date(cursorDateText);
    if (!Number.isNaN(cursorDate.getTime()) && cursorId) {
      const cursorFilter = or(
        lt(photosTable.captureDate, cursorDate),
        and(eq(photosTable.captureDate, cursorDate), lt(photosTable.id, cursorId)),
      );
      if (cursorFilter) filters.push(cursorFilter);
    } else if (!Number.isNaN(cursorDate.getTime())) {
      filters.push(lt(photosTable.captureDate, cursorDate));
    }
  }
  if (query.albumId) filters.push(sql`exists (select 1 from album_photos where album_photos.album_id = ${query.albumId} and album_photos.photo_id = ${photosTable.id})`);
  if (query.albumId) countFilters.push(sql`exists (select 1 from album_photos where album_photos.album_id = ${query.albumId} and album_photos.photo_id = ${photosTable.id})`);
  const rows = await db.select().from(photosTable).where(and(...filters)).orderBy(desc(photosTable.captureDate), desc(photosTable.id)).limit(query.limit + 1);
  const hasNext = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  const albumMap = await albumIdsForPhotos(pageRows.map((row) => row.id));
  const sourceMap = await sourceInfoForPhotos(pageRows.map((row) => row.id));
  const [count] = await db.select({ count: sql<number>`count(*)` }).from(photosTable).where(and(...countFilters));
  const response = {
    items: pageRows.map((row) => mediaResponse(row, albumMap.get(row.id) ?? [], sourceMap.get(row.id) ?? [])),
    nextCursor: hasNext ? `${pageRows.at(-1)?.captureDate.toISOString()}|${pageRows.at(-1)?.id}` : null,
    total: Number(count?.count ?? 0),
  };
  res.json(ListPhotosResponse.parse(response));
});

router.get("/photos/:photoId", async (req, res): Promise<void> => {
  const parsed = GetPhotoParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [photo] = await db.select().from(photosTable).where(and(eq(photosTable.id, parsed.data.photoId), eq(photosTable.userId, res.locals.user.userId))).limit(1);
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json(mediaResponse(photo, await albumIdsForPhoto(photo.id), await sourceInfoForPhoto(photo.id)));
});

router.get("/photos/:photoId/:variant", async (req, res): Promise<void> => {
  const parsed = GetPhotoParams.safeParse(req.params);
  const variant = req.params.variant;
  if (!parsed.success || !["thumbnail", "medium", "original", "download"].includes(variant)) {
    res.status(400).json({ error: "Invalid media request" });
    return;
  }
  const [photo] = await db.select().from(photosTable).where(and(eq(photosTable.id, parsed.data.photoId), eq(photosTable.userId, res.locals.user.userId))).limit(1);
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  const filePath = variant === "original" || variant === "download" ? photo.originalPath : variant === "medium" ? photo.thumbnailMediumPath : photo.thumbnailSmallPath;
  if (!filePath) {
    res.status(404).json({ error: "Media derivative not available" });
    return;
  }
  if (!isManagedPath(filePath)) {
    res.status(500).json({ error: "Media path is outside managed storage" });
    return;
  }
  try {
    await fs.access(filePath);
    if (variant === "download") res.download(filePath, photo.filename);
    else res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: "Media file not found" });
  }
});

router.get("/photos/:photoId/download", async (req, res): Promise<void> => {
  const parsed = DownloadPhotoParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [photo] = await db.select().from(photosTable).where(and(eq(photosTable.id, parsed.data.photoId), eq(photosTable.userId, res.locals.user.userId))).limit(1);
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  if (!isManagedPath(photo.originalPath)) {
    res.status(500).json({ error: "Media path is outside managed storage" });
    return;
  }
  try {
    await fs.access(photo.originalPath);
    res.download(photo.originalPath, photo.filename);
  } catch {
    res.status(404).json({ error: "Original file not found" });
  }
});

router.delete("/photos/:photoId", async (req, res): Promise<void> => {
  const parsed = DeletePhotoParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [photo] = await db.update(photosTable).set({ isTrashed: true, trashedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(photosTable.id, parsed.data.photoId), eq(photosTable.userId, res.locals.user.userId))).returning();
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.sendStatus(204);
});

router.patch("/photos/:photoId/favorite", async (req, res): Promise<void> => {
  const params = ToggleFavoriteParams.safeParse(req.params);
  const body = ToggleFavoriteBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [photo] = await db.update(photosTable).set({ isFavorite: body.data.isFavorite, updatedAt: new Date() }).where(and(eq(photosTable.id, params.data.photoId), eq(photosTable.userId, res.locals.user.userId))).returning();
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json(ToggleFavoriteResponse.parse(mediaResponse(photo, await albumIdsForPhoto(photo.id), await sourceInfoForPhoto(photo.id))));
});

router.patch("/photos/:photoId/archive", async (req, res): Promise<void> => {
  const params = ToggleArchiveParams.safeParse(req.params);
  const body = ToggleArchiveBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [photo] = await db.update(photosTable).set({ isArchived: body.data.isArchived, updatedAt: new Date() })
    .where(and(eq(photosTable.id, params.data.photoId), eq(photosTable.userId, res.locals.user.userId), eq(photosTable.isTrashed, false))).returning();
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json(ToggleArchiveResponse.parse(mediaResponse(photo, await albumIdsForPhoto(photo.id), await sourceInfoForPhoto(photo.id))));
});

router.post("/photos/:photoId/restore", async (req, res): Promise<void> => {
  const params = RestorePhotoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [photo] = await db.update(photosTable).set({ isTrashed: false, trashedAt: null, updatedAt: new Date() })
    .where(and(eq(photosTable.id, params.data.photoId), eq(photosTable.userId, res.locals.user.userId))).returning();
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json(RestorePhotoResponse.parse(mediaResponse(photo, await albumIdsForPhoto(photo.id), await sourceInfoForPhoto(photo.id))));
});

router.delete("/photos/:photoId/permanent", async (req, res): Promise<void> => {
  const params = PermanentlyDeletePhotoParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [photo] = await db.delete(photosTable).where(and(eq(photosTable.id, params.data.photoId), eq(photosTable.userId, res.locals.user.userId), eq(photosTable.isTrashed, true))).returning();
  if (!photo) {
    res.status(404).json({ error: "Trashed photo not found" });
    return;
  }
  await db.delete(albumPhotosTable).where(eq(albumPhotosTable.photoId, photo.id));
  await db.delete(assetSourcesTable).where(eq(assetSourcesTable.assetId, photo.id));
  await Promise.all([photo.originalPath, photo.thumbnailSmallPath, photo.thumbnailMediumPath].filter(Boolean).map((file) => fs.rm(file as string, { force: true })));
  res.sendStatus(204);
});

router.delete("/trash", requireUser, async (_req, res): Promise<void> => {
  const trashed = await db.select({ id: photosTable.id, originalPath: photosTable.originalPath, thumbnailSmallPath: photosTable.thumbnailSmallPath, thumbnailMediumPath: photosTable.thumbnailMediumPath })
    .from(photosTable).where(and(eq(photosTable.userId, res.locals.user.userId), eq(photosTable.isTrashed, true)));
  const ids = trashed.map((photo) => photo.id);
  if (ids.length) {
    await db.delete(albumPhotosTable).where(inArray(albumPhotosTable.photoId, ids));
    await db.delete(assetSourcesTable).where(inArray(assetSourcesTable.assetId, ids));
  }
  await db.delete(photosTable).where(and(eq(photosTable.userId, res.locals.user.userId), eq(photosTable.isTrashed, true)));
  await Promise.all(trashed.flatMap((photo) => [photo.originalPath, photo.thumbnailSmallPath, photo.thumbnailMediumPath]).filter(Boolean).map((file) => fs.rm(file as string, { force: true })));
  res.sendStatus(204);
});

export default router;