import crypto from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  aiFeatures,
  aiJobsTable,
  aiSettingsTable,
  db,
  photosTable,
} from "@workspace/db";
import type { AiFeature, AiSettingsRecord } from "@workspace/db";

const BACKFILL_BATCH_SIZE = 500;
const QUEUE_MODEL_VERSION = "phase-1-queue";

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

export async function enqueueAiJobsForPhoto(userId: string, photoId: string) {
  const settings = await ensureAiSettings(userId);
  const features = enabledFeatures(settings);
  if (!settings.processingEnabled || !features.length) return 0;
  const inserted = await db.insert(aiJobsTable).values(features.map((feature) => ({
    id: crypto.randomUUID(),
    userId,
    photoId,
    feature,
    status: "queued",
    modelVersion: QUEUE_MODEL_VERSION,
    requestedFeatures: [feature],
  }))).onConflictDoNothing().returning({ id: aiJobsTable.id });
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
    const jobs = photos.flatMap((photo) => features.map((feature) => ({
      id: crypto.randomUUID(),
      userId,
      photoId: photo.id,
      feature,
      status: "queued",
      modelVersion: QUEUE_MODEL_VERSION,
      requestedFeatures: [feature],
    })));
    if (jobs.length) {
      const inserted = await db.insert(aiJobsTable).values(jobs)
        .onConflictDoNothing()
        .returning({ id: aiJobsTable.id });
      created += inserted.length;
    }
    cursor = photos[photos.length - 1].id;
  }
  return created;
}

export async function retryFailedAiJobs(userId: string) {
  const retried = await db.update(aiJobsTable)
    .set({
      status: "queued",
      error: null,
      startedAt: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(aiJobsTable.userId, userId), eq(aiJobsTable.status, "failed")))
    .returning({ id: aiJobsTable.id });
  return retried.length;
}

export async function getAiStatus(userId: string, worker: {
  status: "running" | "stopped" | "unavailable";
  lastHeartbeat: Date | null;
  currentJobId: string | null;
}) {
  const settings = await ensureAiSettings(userId);
  const [counts] = await db.select({
    total: sql<number>`count(*)`,
    queued: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'queued')`,
    processing: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'processing')`,
    completed: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'completed')`,
    failed: sql<number>`count(*) filter (where ${aiJobsTable.status} = 'failed')`,
  }).from(aiJobsTable).where(eq(aiJobsTable.userId, userId));
  const [lastProcessed] = await db.select({
    filename: photosTable.filename,
    completedAt: aiJobsTable.completedAt,
  }).from(aiJobsTable)
    .innerJoin(photosTable, eq(photosTable.id, aiJobsTable.photoId))
    .where(and(
      eq(aiJobsTable.userId, userId),
      eq(aiJobsTable.status, "completed"),
      isNotNull(aiJobsTable.completedAt),
    ))
    .orderBy(desc(aiJobsTable.completedAt))
    .limit(1);
  const [lastFailed] = await db.select({ error: aiJobsTable.error })
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.userId, userId), eq(aiJobsTable.status, "failed")))
    .orderBy(desc(aiJobsTable.updatedAt))
    .limit(1);
  const total = Number(counts?.total ?? 0);
  const completed = Number(counts?.completed ?? 0);
  return {
    settings,
    worker,
    totalJobs: total,
    queued: Number(counts?.queued ?? 0),
    processing: Number(counts?.processing ?? 0),
    completed,
    failed: Number(counts?.failed ?? 0),
    overallProgress: total ? Math.round((completed / total) * 100) : 0,
    lastProcessedItem: lastProcessed?.filename ?? null,
    lastProcessedAt: lastProcessed?.completedAt ?? null,
    currentModel: settings.visionModel || QUEUE_MODEL_VERSION,
    lastError: lastFailed?.error ?? null,
  };
}

export const supportedAiFeatures = aiFeatures;