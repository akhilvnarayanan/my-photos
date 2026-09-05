import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { aiJobsTable } from "@workspace/db/schema";
import { db } from "../db";

export type AiJobStatus = "queued" | "processing" | "completed" | "failed";

export async function enqueueAiJob(userId: string, photoId: string, requestedFeatures = "all") {
  const existing = await db.select().from(aiJobsTable).where(eq(aiJobsTable.photoId, photoId)).limit(1);
  if (existing[0]) return existing[0];

  const [job] = await db.insert(aiJobsTable).values({
    id: randomUUID(),
    userId,
    photoId,
    requestedFeatures,
    status: "queued",
  }).returning();
  return job;
}

export async function claimNextAiJob() {
  const candidate = await db.select().from(aiJobsTable)
    .where(eq(aiJobsTable.status, "queued"))
    .orderBy(asc(aiJobsTable.createdAt))
    .limit(1);

  if (!candidate[0]) return null;

  const [claimed] = await db.update(aiJobsTable)
    .set({ status: "processing", attempts: candidate[0].attempts + 1, startedAt: new Date(), error: null })
    .where(and(eq(aiJobsTable.id, candidate[0].id), eq(aiJobsTable.status, "queued")))
    .returning();

  return claimed ?? null;
}

export async function completeAiJob(id: string, modelVersion?: string) {
  const [job] = await db.update(aiJobsTable)
    .set({ status: "completed", completedAt: new Date(), modelVersion: modelVersion ?? null, error: null })
    .where(eq(aiJobsTable.id, id)).returning();
  return job;
}

export async function failAiJob(id: string, error: string, retry = true) {
  const [job] = await db.select().from(aiJobsTable).where(eq(aiJobsTable.id, id)).limit(1);
  if (!job) return null;

  const status: AiJobStatus = retry && job.attempts < 3 ? "queued" : "failed";
  const [updated] = await db.update(aiJobsTable)
    .set({ status, error, completedAt: status === "failed" ? new Date() : null })
    .where(eq(aiJobsTable.id, id)).returning();
  return updated;
}
