import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { db, photoPlacesTable, photosTable, placesTable } from "@workspace/db";
import { requireUser } from "../lib/auth";
import { backfillGeocodingJobs, getGeocodingStatus, retryFailedGeocodingJobs } from "../lib/geocoding";
import { escapeLike } from "../lib/search";

const router: IRouter = Router();
router.use(requireUser);

router.get("/places", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const rows = await db.select({
    id: placesTable.id,
    country: placesTable.country,
    state: placesTable.state,
    city: placesTable.city,
    locality: placesTable.locality,
    district: placesTable.district,
    formattedName: placesTable.formattedName,
    latitude: placesTable.latitude,
    longitude: placesTable.longitude,
    placeType: placesTable.placeType,
    landmark: placesTable.landmark,
    photoCount: sql<number>`count(distinct ${photoPlacesTable.photoId})`,
    coverId: sql<string | null>`min(${photosTable.id})`,
  }).from(placesTable)
    .leftJoin(photoPlacesTable, and(eq(photoPlacesTable.placeId, placesTable.id), eq(photoPlacesTable.userId, userId)))
    .leftJoin(photosTable, and(eq(photosTable.id, photoPlacesTable.photoId), eq(photosTable.userId, userId)))
    .where(eq(placesTable.userId, userId))
    .groupBy(placesTable.id)
    .orderBy(desc(sql`count(distinct ${photoPlacesTable.photoId})`), desc(placesTable.updatedAt))
    .limit(250);

  res.json(rows.map((row) => ({
    id: row.id,
    label: row.formattedName ?? row.landmark ?? row.city ?? row.state ?? row.country ?? "Unknown place",
    country: row.country,
    state: row.state,
    city: row.city,
    locality: row.locality,
    district: row.district,
    landmark: row.landmark,
    placeType: row.placeType,
    latitude: row.latitude ? Number(row.latitude) : null,
    longitude: row.longitude ? Number(row.longitude) : null,
    photoCount: Number(row.photoCount ?? 0),
    coverUrl: row.coverId ? `/api/photos/${row.coverId}/thumbnail` : null,
  })));
});

router.get("/places/search", async (req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const query = (req.query.q ?? "").toString().trim();
  if (!query) {
    res.json([]);
    return;
  }
  const like = `%${escapeLike(query)}%`;
  const rows = await db.select({
    id: placesTable.id,
    label: placesTable.formattedName,
    country: placesTable.country,
    state: placesTable.state,
    city: placesTable.city,
    locality: placesTable.locality,
    landmark: placesTable.landmark,
    latitude: placesTable.latitude,
    longitude: placesTable.longitude,
    photoCount: sql<number>`count(distinct ${photoPlacesTable.photoId})`,
  }).from(placesTable)
    .leftJoin(photoPlacesTable, and(eq(photoPlacesTable.placeId, placesTable.id), eq(photoPlacesTable.userId, userId)))
    .where(and(
      eq(placesTable.userId, userId),
      sql`(${placesTable.country} ilike ${like} escape '!' or ${placesTable.state} ilike ${like} escape '!' or ${placesTable.city} ilike ${like} escape '!' or ${placesTable.locality} ilike ${like} escape '!' or ${placesTable.district} ilike ${like} escape '!' or ${placesTable.formattedName} ilike ${like} escape '!' or ${placesTable.landmark} ilike ${like} escape '!')`,
    ))
    .groupBy(placesTable.id)
    .orderBy(desc(sql`count(distinct ${photoPlacesTable.photoId})`))
    .limit(50);

  res.json(rows.map((row) => ({
    id: row.id,
    label: row.label ?? row.landmark ?? row.city ?? row.state ?? row.country ?? "Unknown place",
    country: row.country,
    state: row.state,
    city: row.city,
    locality: row.locality,
    landmark: row.landmark,
    latitude: row.latitude ? Number(row.latitude) : null,
    longitude: row.longitude ? Number(row.longitude) : null,
    photoCount: Number(row.photoCount ?? 0),
  })));
});

router.get("/places/stats", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const [summary] = await db.select({
    placeCount: sql<number>`count(*)`,
    photoCount: sql<number>`count(distinct ${photoPlacesTable.photoId})`,
    totalPhotos: sql<number>`count(*) filter (where ${photosTable.mediaType} = 'photo')`,
  }).from(placesTable)
    .leftJoin(photoPlacesTable, and(eq(photoPlacesTable.placeId, placesTable.id), eq(photoPlacesTable.userId, userId)))
    .leftJoin(photosTable, and(eq(photosTable.id, photoPlacesTable.photoId), eq(photosTable.userId, userId)))
    .where(eq(placesTable.userId, userId));

  res.json({
    placeCount: Number(summary?.placeCount ?? 0),
    photoCount: Number(summary?.photoCount ?? 0),
    totalPhotos: Number(summary?.totalPhotos ?? 0),
  });
});

router.get("/places/geocoding/status", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  res.json(await getGeocodingStatus(userId));
});

router.post("/places/geocode", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const result = await backfillGeocodingJobs(userId);
  res.status(202).json(result);
});

router.post("/places/geocode/retry", async (_req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const retried = await retryFailedGeocodingJobs(userId);
  res.status(202).json({ retried });
});

router.get("/places/:id", async (req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const [place] = await db.select().from(placesTable)
    .where(and(eq(placesTable.userId, userId), eq(placesTable.id, req.params.id)))
    .limit(1);
  if (!place) {
    res.status(404).json({ error: "Place not found" });
    return;
  }

  const [summary] = await db.select({
    photoCount: sql<number>`count(distinct ${photoPlacesTable.photoId})`,
    earliest: sql<Date | null>`min(${photosTable.captureDate})`,
    latest: sql<Date | null>`max(${photosTable.captureDate})`,
  }).from(photoPlacesTable)
    .leftJoin(photosTable, and(eq(photosTable.id, photoPlacesTable.photoId), eq(photosTable.userId, userId)))
    .where(and(eq(photoPlacesTable.userId, userId), eq(photoPlacesTable.placeId, place.id), eq(photosTable.isTrashed, false)));

  res.json({
    ...place,
    latitude: place.latitude ? Number(place.latitude) : null,
    longitude: place.longitude ? Number(place.longitude) : null,
    photoCount: Number(summary?.photoCount ?? 0),
    earliestPhotoDate: summary?.earliest ?? null,
    latestPhotoDate: summary?.latest ?? null,
    coverUrl: place.id ? `/api/photos/${place.id}/thumbnail` : null,
  });
});

router.get("/places/:id/photos", async (req, res): Promise<void> => {
  const userId = res.locals.user.userId as string;
  const limit = Math.max(1, Math.min(60, Number(req.query.limit ?? 30)));
  const rows = await db.select({
    photo: photosTable,
  }).from(photoPlacesTable)
    .innerJoin(photosTable, and(eq(photosTable.id, photoPlacesTable.photoId), eq(photosTable.userId, userId)))
    .where(and(eq(photoPlacesTable.userId, userId), eq(photoPlacesTable.placeId, req.params.id), eq(photosTable.isTrashed, false)))
    .orderBy(desc(photosTable.captureDate), desc(photosTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit).map((row) => row.photo);
  res.json({
    items: pageRows.map((photo) => ({
      id: photo.id,
      filename: photo.filename,
      thumbnailUrl: `/api/photos/${photo.id}/thumbnail`,
      mediumUrl: `/api/photos/${photo.id}/medium`,
      originalUrl: `/api/photos/${photo.id}/original`,
      captureDate: photo.captureDate,
      latitude: photo.latitude ? Number(photo.latitude) : null,
      longitude: photo.longitude ? Number(photo.longitude) : null,
      isFavorite: photo.isFavorite,
    })),
    nextCursor: hasMore ? pageRows.at(-1)?.id ?? null : null,
    hasMore,
    total: pageRows.length,
  });
});

export default router;
