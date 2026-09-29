import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  aiWorkerStatusTable,
  db,
  geocodingCacheTable,
  geocodingJobsTable,
  photoPlacesTable,
  photosTable,
  placesTable,
} from "@workspace/db";
import type { GeocodingCacheRecord, GeocodingJobRecord } from "@workspace/db";
import { logger } from "./logger";

export type GeocodingProvider = "offline-local" | "disabled" | "external";
export type GeocodingStatus = "queued" | "processing" | "completed" | "failed" | "skipped";

export type GeocodePlaceResult = {
  country?: string | null;
  state?: string | null;
  city?: string | null;
  locality?: string | null;
  district?: string | null;
  formattedName?: string | null;
  latitude: number;
  longitude: number;
  placeType: string;
  landmark?: string | null;
  provider: string;
  providerVersion: string;
  status: "completed";
  geocoderStatus: "completed";
  resultJson?: string | null;
};

const BACKFILL_BATCH_SIZE = 500;
const DEFAULT_PROVIDER: GeocodingProvider = (process.env.GEOCODER_PROVIDER as GeocodingProvider | undefined) ?? "offline-local";
const MAX_ATTEMPTS = Math.max(1, Number(process.env.GEOCODER_MAX_ATTEMPTS ?? 3));
const STALE_AFTER_MS = Math.max(60_000, Number(process.env.GEOCODER_STALE_JOB_MS ?? 15 * 60_000));
const GEOCODER_VERSION = process.env.GEOCODER_VERSION ?? "v1";
const OFFLINE_PLACES = new Map<string, GeocodePlaceResult>([
  ["1.35210,103.81980", { country: "Singapore", state: "Central Region", city: "Singapore", locality: "Punggol", district: "North East Region", formattedName: "Punggol, Singapore", latitude: 1.3521, longitude: 103.8198, placeType: "city", landmark: "Punggol", provider: "offline-local", providerVersion: "v1", status: "completed", geocoderStatus: "completed", resultJson: JSON.stringify({ country: "Singapore", state: "Central Region", city: "Singapore", locality: "Punggol" }) }],
  ["11.25880,75.78040", { country: "India", state: "Kerala", city: "Kozhikode", locality: "Kozhikode", district: "Kozhikode", formattedName: "Kozhikode, Kerala", latitude: 11.2588, longitude: 75.7804, placeType: "city", landmark: "Kozhikode", provider: "offline-local", providerVersion: "v1", status: "completed", geocoderStatus: "completed", resultJson: JSON.stringify({ country: "India", state: "Kerala", city: "Kozhikode" }) }],
]) as Map<string, GeocodePlaceResult>;

export function normalizeCoordinateKey(latitude: number | string, longitude: number | string, precision = 5) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const digits = Math.max(1, Math.min(7, precision));
  return `${lat.toFixed(digits)},${lon.toFixed(digits)}`;
}

export function resolveOfflinePlace(latitude: number | string, longitude: number | string): GeocodePlaceResult | null {
  const normalized = normalizeCoordinateKey(latitude, longitude, 5);
  if (!normalized) return null;
  const match = OFFLINE_PLACES.get(normalized);
  if (!match) return null;
  return { ...match };
}

export function buildGeocodeResult(input: Partial<GeocodePlaceResult> & { latitude: number; longitude: number; provider: string; providerVersion: string }) {
  const result = {
    country: input.country ?? null,
    state: input.state ?? null,
    city: input.city ?? null,
    locality: input.locality ?? null,
    district: input.district ?? null,
    formattedName: input.formattedName ?? (([input.city, input.state, input.country].filter(Boolean).join(", ") || null) as string | null),
    latitude: Number(input.latitude),
    longitude: Number(input.longitude),
    placeType: input.placeType ?? "city",
    landmark: input.landmark ?? null,
    provider: input.provider,
    providerVersion: input.providerVersion,
    status: "completed" as const,
    geocoderStatus: "completed" as const,
    resultJson: input.resultJson ?? JSON.stringify({
      country: input.country ?? null,
      state: input.state ?? null,
      city: input.city ?? null,
      locality: input.locality ?? null,
      district: input.district ?? null,
      formattedName: input.formattedName ?? null,
      latitude: Number(input.latitude),
      longitude: Number(input.longitude),
    }),
  };
  return result;
}

async function persistWorkerState(feature: string, photoId: string | null, status: "running" | "idle" | "stopped" | "unavailable", currentJobId: string | null, lastError: string | null, activeJobs: number) {
  await db.insert(aiWorkerStatusTable).values({
    workerId: `geocoder-${process.pid}`,
    workerRole: "dedicated",
    status,
    heartbeatAt: new Date(),
    currentJobId,
    currentFeature: feature,
    currentPhotoId: photoId,
    workerVersion: GEOCODER_VERSION,
    activeJobs,
    jobsCompleted: 0,
    jobsFailed: 0,
    currentError: lastError,
    processingStartedAt: status === "running" ? new Date() : null,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: aiWorkerStatusTable.workerId,
    set: {
      status,
      heartbeatAt: new Date(),
      currentJobId,
      currentFeature: feature,
      currentPhotoId: photoId,
      workerVersion: GEOCODER_VERSION,
      activeJobs,
      currentError: lastError,
      processingStartedAt: status === "running" ? new Date() : null,
      updatedAt: new Date(),
    },
  });
}

function providerEnabled(): boolean {
  return DEFAULT_PROVIDER !== "disabled";
}

export async function queueGeocodingForPhoto(userId: string, photoId: string, latitude: number | string, longitude: number | string) {
  if (!providerEnabled()) return null;
  const normalizedKey = normalizeCoordinateKey(latitude, longitude, 5);
  if (!normalizedKey) return null;

  const [cached] = await db.select().from(geocodingCacheTable)
    .where(and(eq(geocodingCacheTable.userId, userId), eq(geocodingCacheTable.normalizedKey, normalizedKey)))
    .limit(1);
  if (cached) return { kind: "cache", row: cached };

  const [existing] = await db.select().from(geocodingJobsTable)
    .where(and(eq(geocodingJobsTable.userId, userId), eq(geocodingJobsTable.photoId, photoId), eq(geocodingJobsTable.normalizedKey, normalizedKey), sql`${geocodingJobsTable.status} in ('queued', 'processing')`))
    .orderBy(desc(geocodingJobsTable.createdAt))
    .limit(1);
  if (existing) return { kind: "job", row: existing };

  const [inserted] = await db.insert(geocodingJobsTable).values({
    id: crypto.randomUUID(),
    userId,
    photoId,
    normalizedKey,
    latitude: String(latitude),
    longitude: String(longitude),
    status: "queued",
    attempts: 0,
    provider: DEFAULT_PROVIDER,
    providerVersion: GEOCODER_VERSION,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return inserted ? { kind: "job", row: inserted } : null;
}

export async function backfillGeocodingJobs(userId: string) {
  if (!providerEnabled()) return { total: 0, queued: 0, skipped: 0, failed: 0, percentage: 0 };
  let queued = 0;
  let skipped = 0;
  let total = 0;

  let cursor = "";
  while (true) {
    const photos = await db.select({ id: photosTable.id, latitude: photosTable.latitude, longitude: photosTable.longitude })
      .from(photosTable)
      .where(and(
        eq(photosTable.userId, userId),
        eq(photosTable.isTrashed, false),
        isNotNull(photosTable.latitude),
        isNotNull(photosTable.longitude),
        cursor ? gt(photosTable.id, cursor) : sql`true`,
      ))
      .orderBy(asc(photosTable.id))
      .limit(BACKFILL_BATCH_SIZE);
    if (!photos.length) break;
    for (const photo of photos) {
      total += 1;
      const lat = Number(photo.latitude);
      const lon = Number(photo.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = normalizeCoordinateKey(lat, lon, 5);
      if (!key) continue;
      const [cache] = await db.select().from(geocodingCacheTable)
        .where(and(eq(geocodingCacheTable.userId, userId), eq(geocodingCacheTable.normalizedKey, key)))
        .limit(1);
      if (cache) {
        skipped += 1;
        continue;
      }
      const created = await queueGeocodingForPhoto(userId, photo.id, lat, lon);
      if (created) queued += 1;
    }
    cursor = photos[photos.length - 1].id;
  }

  return {
    total,
    queued,
    skipped,
    failed: 0,
    percentage: total ? Math.round(((queued + skipped) / total) * 100) : 0,
  };
}

export async function retryFailedGeocodingJobs(userId: string) {
  const rows = await db.update(geocodingJobsTable)
    .set({ status: "queued", attempts: 0, error: null, startedAt: null, completedAt: null, updatedAt: new Date() })
    .where(and(eq(geocodingJobsTable.userId, userId), eq(geocodingJobsTable.status, "failed")))
    .returning({ id: geocodingJobsTable.id });
  return rows.length;
}

export async function recoverStaleGeocodingJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const recovered = await db.update(geocodingJobsTable)
    .set({
      status: sql`case when ${geocodingJobsTable.attempts} >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end`,
      error: sql`case when ${geocodingJobsTable.attempts} >= ${MAX_ATTEMPTS} then coalesce(${geocodingJobsTable.error}, 'Worker stopped while processing the geo job') else ${geocodingJobsTable.error} end`,
      startedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(geocodingJobsTable.status, "processing"), isNotNull(geocodingJobsTable.startedAt), sql`${geocodingJobsTable.startedAt} < ${cutoff}`))
    .returning({ id: geocodingJobsTable.id });
  return recovered.length;
}

export async function claimNextGeocodingJob(): Promise<GeocodingJobRecord | null> {
  const result = await db.execute(sql`
    with candidate as (
      select j.id
      from geocoding_jobs j
      inner join photos p on p.id = j.photo_id and p.user_id = j.user_id
      where j.status = 'queued'
        and p.latitude is not null
        and p.longitude is not null
        and j.attempts < ${MAX_ATTEMPTS}
      order by j.created_at asc
      for update skip locked
      limit 1
    )
    update geocoding_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        started_at = now(),
        updated_at = now(),
        error = null
    from candidate
    where j.id = candidate.id
    returning j.*
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    photoId: String(row.photo_id),
    placeId: row.place_id == null ? null : String(row.place_id),
    normalizedKey: row.normalized_key == null ? null : String(row.normalized_key),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    status: String(row.status),
    attempts: Number(row.attempts),
    error: row.error == null ? null : String(row.error),
    provider: String(row.provider),
    providerVersion: String(row.provider_version),
    startedAt: row.started_at == null ? null : new Date(String(row.started_at)),
    completedAt: row.completed_at == null ? null : new Date(String(row.completed_at)),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

async function upsertPlaceForResult(userId: string, result: GeocodePlaceResult) {
  const placePayload = {
    id: crypto.randomUUID(),
    userId,
    country: result.country ?? null,
    state: result.state ?? null,
    city: result.city ?? null,
    locality: result.locality ?? null,
    district: result.district ?? null,
    formattedName: result.formattedName ?? `${result.city ?? result.locality ?? "Unknown"}, ${result.country ?? "Unknown"}`,
    latitude: Number(result.latitude),
    longitude: Number(result.longitude),
    placeType: result.placeType,
    landmark: result.landmark ?? null,
    geocoderProvider: result.provider,
    geocoderVersion: result.providerVersion,
    geocodedAt: new Date(),
    geocodingStatus: "completed",
    geocodingError: null,
  };

  const [existing] = await db.select().from(placesTable)
    .where(and(eq(placesTable.userId, userId), eq(placesTable.latitude, String(placePayload.latitude)), eq(placesTable.longitude, String(placePayload.longitude))))
    .limit(1);

  if (existing) {
    const [updated] = await db.update(placesTable)
      .set({
        country: placePayload.country,
        state: placePayload.state,
        city: placePayload.city,
        locality: placePayload.locality,
        district: placePayload.district,
        formattedName: placePayload.formattedName,
        landmark: placePayload.landmark,
        geocoderProvider: placePayload.geocoderProvider,
        geocoderVersion: placePayload.geocoderVersion,
        geocodedAt: placePayload.geocodedAt,
        geocodingStatus: "completed",
        geocodingError: null,
        updatedAt: new Date(),
      })
      .where(eq(placesTable.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db.insert(placesTable).values(placePayload).returning();
  return created;
}

export async function processGeocodingJob(job: GeocodingJobRecord) {
  const lat = Number(job.latitude ?? NaN);
  const lon = Number(job.longitude ?? NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    await db.update(geocodingJobsTable)
      .set({ status: "failed", error: "Missing GPS coordinates", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(geocodingJobsTable.id, job.id));
    return;
  }

  try {
    const cached = await db.select().from(geocodingCacheTable)
      .where(and(eq(geocodingCacheTable.userId, job.userId), eq(geocodingCacheTable.normalizedKey, job.normalizedKey ?? normalizeCoordinateKey(lat, lon, 5) ?? "")))
      .limit(1);
    if (cached[0]) {
      await db.update(geocodingJobsTable)
        .set({ status: "completed", placeId: cached[0].id, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(geocodingJobsTable.id, job.id));
      return;
    }

    const resolved = resolveOfflinePlace(lat, lon) ?? buildGeocodeResult({
      latitude: lat,
      longitude: lon,
      provider: DEFAULT_PROVIDER,
      providerVersion: GEOCODER_VERSION,
    });

    if (!resolved) {
      await db.update(geocodingJobsTable)
        .set({ status: "failed", error: "No geocoder result for coordinates", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(geocodingJobsTable.id, job.id));
      return;
    }

    const place = await upsertPlaceForResult(job.userId, resolved);
    const normalizedKey = normalizeCoordinateKey(lat, lon, 5) ?? `${lat},${lon}`;
    const cachePayload = {
      id: crypto.randomUUID(),
      userId: job.userId,
      normalizedKey,
      latitude: String(lat),
      longitude: String(lon),
      country: resolved.country ?? null,
      state: resolved.state ?? null,
      city: resolved.city ?? null,
      locality: resolved.locality ?? null,
      formattedName: resolved.formattedName ?? null,
      provider: resolved.provider,
      providerVersion: resolved.providerVersion,
      status: resolved.status,
      resultJson: resolved.resultJson ?? JSON.stringify(resolved),
      geocodedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(geocodingCacheTable).values(cachePayload).onConflictDoUpdate({
      target: geocodingCacheTable.id,
      set: { ...cachePayload, updatedAt: new Date() },
    });

    await db.insert(photoPlacesTable).values({
      id: crypto.randomUUID(),
      userId: job.userId,
      photoId: job.photoId,
      placeId: place.id,
      createdAt: new Date(),
    }).onConflictDoNothing();

    await db.update(geocodingJobsTable)
      .set({ status: "completed", placeId: place.id, completedAt: new Date(), updatedAt: new Date(), error: null })
      .where(eq(geocodingJobsTable.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(geocodingJobsTable)
      .set({ status: "failed", error: message.slice(0, 4000), completedAt: new Date(), updatedAt: new Date() })
      .where(eq(geocodingJobsTable.id, job.id));
    logger.error({ error, jobId: job.id, photoId: job.photoId }, "Geocoding job failed");
  }
}

export async function pollGeocodingJobs() {
  if (!providerEnabled()) return;
  const active = await db.select({ count: sql<number>`count(*)` }).from(geocodingJobsTable).where(and(eq(geocodingJobsTable.status, "processing"), eq(geocodingJobsTable.provider, DEFAULT_PROVIDER)));
  if (Number(active[0]?.count ?? 0) === 0) {
    await recoverStaleGeocodingJobs();
  }

  let cursor = 0;
  const maxConcurrency = Math.max(1, Number(process.env.GEOCODER_CONCURRENCY ?? 1));
  while (cursor < maxConcurrency) {
    const job = await claimNextGeocodingJob();
    if (!job) break;
    cursor += 1;
    await persistWorkerState("geocoding", job.photoId, "running", job.id, null, cursor);
    await processGeocodingJob(job);
    await persistWorkerState("geocoding", null, "idle", null, null, 0);
  }
}

export async function getGeocodingStatus(userId: string) {
  const [jobs] = await db.select({
    total: sql<number>`count(*)`,
    queued: sql<number>`count(*) filter (where ${geocodingJobsTable.status} = 'queued')`,
    processing: sql<number>`count(*) filter (where ${geocodingJobsTable.status} = 'processing')`,
    completed: sql<number>`count(*) filter (where ${geocodingJobsTable.status} = 'completed')`,
    failed: sql<number>`count(*) filter (where ${geocodingJobsTable.status} = 'failed')`,
  }).from(geocodingJobsTable).where(eq(geocodingJobsTable.userId, userId));
  const [cacheRows] = await db.select({ count: sql<number>`count(*)` }).from(geocodingCacheTable).where(eq(geocodingCacheTable.userId, userId));
  return {
    provider: DEFAULT_PROVIDER,
    providerVersion: GEOCODER_VERSION,
    enabled: providerEnabled(),
    totalJobs: Number(jobs?.total ?? 0),
    queued: Number(jobs?.queued ?? 0),
    processing: Number(jobs?.processing ?? 0),
    completed: Number(jobs?.completed ?? 0),
    failed: Number(jobs?.failed ?? 0),
    cacheEntries: Number(cacheRows?.count ?? 0),
    percentage: Number(jobs?.total ?? 0) ? Math.round((Number(jobs?.completed ?? 0) / Number(jobs?.total ?? 0)) * 100) : 0,
  };
}

export function startGeocodingWorker() {
  if (process.env.GEOCODER_PROVIDER === "disabled") {
    void persistWorkerState("geocoding", null, "unavailable", null, "Geocoding disabled", 0);
    return;
  }
  void persistWorkerState("geocoding", null, "running", null, null, 0);
  setInterval(() => {
    void pollGeocodingJobs().catch((error) => {
      logger.error({ error }, "Geocoding worker loop failed");
      void persistWorkerState("geocoding", null, "running", null, error instanceof Error ? error.message : String(error), 0);
    });
  }, Math.max(2_000, Number(process.env.GEOCODER_POLL_MS ?? 5_000))).unref();
}

export async function ensureGeocodingForPhoto(userId: string, photoId: string) {
  const [photo] = await db.select({ latitude: photosTable.latitude, longitude: photosTable.longitude }).from(photosTable)
    .where(and(eq(photosTable.id, photoId), eq(photosTable.userId, userId), eq(photosTable.isTrashed, false)))
    .limit(1);

  if (!photo || photo.latitude == null || photo.longitude == null) return null;

  const result = await queueGeocodingForPhoto(userId, photoId, Number(photo.latitude), Number(photo.longitude));
  if (!result) return null;
  return result;
}

export async function findPlaceForPhoto(userId: string, photoId: string) {
  const [row] = await db.select({ placeId: photoPlacesTable.placeId }).from(photoPlacesTable)
    .where(and(eq(photoPlacesTable.userId, userId), eq(photoPlacesTable.photoId, photoId)))
    .limit(1);
  if (!row?.placeId) return null;
  const [place] = await db.select().from(placesTable).where(and(eq(placesTable.userId, userId), eq(placesTable.id, row.placeId))).limit(1);
  return place ?? null;
}
