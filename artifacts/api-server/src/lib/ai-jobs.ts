import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  aiFeatures,
  aiJobsTable,
  aiSettingsTable,
  db,
  photoTextTable,
  photosTable,
} from "@workspace/db";
import type { AiFeature, AiJobRecord, AiSettingsRecord } from "@workspace/db";

const BACKFILL_BATCH_SIZE = 500;
const QUEUE_MODEL_VERSION = "local-tesseract";
const MAX_ATTEMPTS = Math.max(1, Number(process.env.AI_MAX_ATTEMPTS ?? 3));
const STALE_AFTER_MS = Math.max(60_000, Number(process.env.AI_STALE_JOB_MS ?? 15 * 60_000));

function enabledFeatures(settings: AiSettingsRecord): AiFeature[] {
  return [
    settings.ocrEnabled && "OCR",
    settings.objectDetectionEnabled && "OBJECT_DETECTION",
    settings.faceDetectionEnabled && "FACE_DETECTION",
    settings.sceneRecognitionEnabled && "SCENE_RECOGNITION",
  ].filter((feature): feature is AiFeature => Boolean(feature));
}

export async function ensureAiSettings(userId: string) {
  await db.insert(aiSettingsTable).values({ userId }).onConflictDoNothing();
  const [settings] = await db.select().from(aiSettingsTable).where(eq(aiSettingsTable.userId, userId)).limit(1);
  if (!settings) throw new Error("Could not initialize AI settings");
  return settings;
}

export async function updateAiSettings(userId: string, values: Partial<typeof aiSettingsTable.$inferInsert>) {
  await ensureAiSettings(userId);
  const [settings] = await db.update(aiSettingsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(aiSettingsTable.userId, userId))
    .returning();
  if (!settings) throw new Error("Could not update AI settings");
  return settings;
}

function newJob(userId: string, photoId: string, feature: AiFeature) {
  return {
    id: crypto.randomUUID(),
    userId,
    photoId,
    feature,
    status: "queued",
    modelVersion: feature === "OCR" ? QUEUE_MODEL_VERSION : "phase-1-queue",
    requestedFeatures: [feature],
  };
}

export async function enqueueAiJobsForPhoto(userId: string, photoId: string) {
  const settings = await ensureAiSettings(userId);
  const features = enabledFeatures(settings);
  if (!settings.processingEnabled || !features.length) return 0;
  const inserted = await db.insert(aiJobsTable).values(features.map((feature) => newJob(userId, photoId, feature)))
    .onConflictDoNothing()
    .returning({ id: aiJobsTable.id });
  return inserted.length;
}

export async function backfillAiJobs(userId: string) {
  const settings = await ensureAiSettings(userId);
  const features = enabledFeatures(settings);
  if (!settings.processingEnabled || !features.length) return 0;

  let cursor = "";
  let created = 0;
  while (true) {
    const photos = await db.select({ id: photosTable.id })
      .from(photosTable)
      .where(and(
        eq(photosTable.userId, userId),
        eq(photosTable.isTrashed, false),
        cursor ? gt(photosTable.id, cursor) : sql`true`,
      ))
      .orderBy(asc(photosTable.id))
      .limit(BACKFILL_BATCH_SIZE);
    if (!photos.length) break;
    const jobs = photos.flatMap((photo) => features.map((feature) => newJob(userId, photo.id, feature)));
    const inserted = await db.insert(aiJobsTable).values(jobs).onConflictDoNothing().returning({ id: aiJobsTable.id });
    created += inserted.length;
    cursor = photos[photos.length - 1].id;
  }
  return created;
}

export async function retryFailedAiJobs(userId: string) {
  const retried = await db.update(aiJobsTable)
    .set({ status: "queued", attempts: 0, error: null, startedAt: null, completedAt: null, updatedAt: new Date() })
    .where(and(eq(aiJobsTable.userId, userId), eq(aiJobsTable.status, "failed")))
    .returning({ id: aiJobsTable.id });
  return retried.length;
}

export async function recoverStaleAiJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const recovered = await db.update(aiJobsTable)
    .set({
      status: sql`case when ${aiJobsTable.attempts} >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end`,
      error: sql`case when ${aiJobsTable.attempts} >= ${MAX_ATTEMPTS} then coalesce(${aiJobsTable.error}, 'Worker stopped while processing the job') else ${aiJobsTable.error} end`,
      startedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(aiJobsTable.status, "processing"), isNotNull(aiJobsTable.startedAt), sql`${aiJobsTable.startedAt} < ${cutoff}`))
    .returning({ id: aiJobsTable.id });
  const exhausted = await db.update(aiJobsTable)
    .set({
      status: "failed",
      error: sql`coalesce(${aiJobsTable.error}, 'Maximum OCR attempts reached')`,
      startedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(aiJobsTable.status, "queued"), sql`${aiJobsTable.attempts} >= ${MAX_ATTEMPTS}`))
    .returning({ id: aiJobsTable.id });
  return recovered.length + exhausted.length;
}

export async function claimNextOcrJob(): Promise<AiJobRecord | null> {
  const result = await db.execute(sql`
    with candidate as (
      select j.id
      from ai_jobs j
      inner join ai_settings s on s.user_id = j.user_id
      inner join photos p on p.id = j.photo_id and p.user_id = j.user_id
      where j.feature = 'OCR'
        and j.status = 'queued'
        and p.media_type = 'photo'
        and p.is_trashed = false
        and s.processing_enabled = true
        and s.processing_paused = false
        and s.ocr_enabled = true
        and j.attempts < ${MAX_ATTEMPTS}
      order by case when s.processing_priority = 'low' then 1 else 0 end, j.created_at, j.id
      for update skip locked
      limit 1
    )
    update ai_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        started_at = now(),
        updated_at = now(),
        error = null,
        model_version = ${QUEUE_MODEL_VERSION},
        requested_features = array['OCR']
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
    feature: String(row.feature),
    status: String(row.status),
    attempts: Number(row.attempts),
    error: row.error == null ? null : String(row.error),
    startedAt: row.started_at == null ? null : new Date(String(row.started_at)),
    completedAt: row.completed_at == null ? null : new Date(String(row.completed_at)),
    modelVersion: row.model_version == null ? null : String(row.model_version),
    requestedFeatures: Array.isArray(row.requested_features) ? row.requested_features.map(String) : [],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export async function completeOcrJob(job: AiJobRecord, text: string, confidence: number | null, language: string) {
  await db.transaction(async (tx) => {
    await tx.insert(photoTextTable).values({
      photoId: job.photoId,
      userId: job.userId,
      text,
      confidence,
      language,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: photoTextTable.photoId,
      set: { text, confidence, language, updatedAt: new Date() },
    });
    await tx.update(aiJobsTable)
      .set({ status: "completed", completedAt: new Date(), startedAt: null, error: null, updatedAt: new Date() })
      .where(and(eq(aiJobsTable.id, job.id), eq(aiJobsTable.status, "processing")));
  });
}

export async function failAiJob(job: AiJobRecord, error: string) {
  const safeError = error.slice(0, 4000);
  await db.update(aiJobsTable)
    .set({
      status: job.attempts >= MAX_ATTEMPTS ? "failed" : "queued",
      error: safeError,
      startedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(aiJobsTable.id, job.id), eq(aiJobsTable.status, "processing")));
}

export async function getAiStatus(userId: string, worker: {
  status: "running" | "stopped" | "unavailable";
  lastHeartbeat: Date | null;
  currentJobId: string | null;
  activeJobs: number;
  lastError: string | null;
}) {
  const settings = await ensureAiSettings(userId);
  const [counts] = await db.select({
    total: sql<number>`count(*)`,
    queued: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'queued')`,
    processing: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'processing')`,
    completed: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'completed')`,
    failed: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'failed')`,
  }).from(aiJobsTable).where(and(eq(aiJobsTable.userId, userId), eq(aiJobsTable.feature, "OCR")));
  const [lastProcessed] = await db.select({
    filename: photosTable.filename,
    completedAt: aiJobsTable.completedAt,
  }).from(aiJobsTable)
    .innerJoin(photosTable, eq(photosTable.id, aiJobsTable.photoId))
    .where(and(eq(aiJobsTable.userId, userId), eq(aiJobsTable.feature, "OCR"), eq(aiJobsTable.status, "completed"), isNotNull(aiJobsTable.completedAt)))
    .orderBy(desc(aiJobsTable.completedAt))
    .limit(1);
  const [lastFailed] = await db.select({ error: aiJobsTable.error })
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.userId, userId), eq(aiJobsTable.feature, "OCR"), eq(aiJobsTable.status, "failed")))
    .orderBy(desc(aiJobsTable.updatedAt))
    .limit(1);
  const total = Number(counts?.total ?? 0);
  return {
    settings,
    worker,
    totalJobs: total,
    queued: Number(counts?.queued ?? 0),
    processing: Number(counts?.processing ?? 0),
    completed: Number(counts?.completed ?? 0),
    failed: Number(counts?.failed ?? 0),
    overallProgress: total ? Math.round((Number(counts?.completed ?? 0) / total) * 100) : 0,
    lastProcessedItem: lastProcessed?.filename ?? null,
    lastProcessedAt: lastProcessed?.completedAt ?? null,
    currentModel: QUEUE_MODEL_VERSION,
    lastError: lastFailed?.error ?? worker.lastError,
  };
}

export const supportedAiFeatures = aiFeatures;