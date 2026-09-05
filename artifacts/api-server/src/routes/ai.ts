import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { aiJobsTable, db, photosTable } from "@workspace/db";
import { requireUser } from "../lib/auth";
import { enqueueAiJob } from "../lib/ai-jobs";

const router = Router();
router.use("/ai", requireUser);

router.get("/ai/status", async (_req, res) => {
  const userId = res.locals.user.userId as string;
  const rows = await db.select({
    status: aiJobsTable.status,
    count: sql<number>`count(*)::int`,
  }).from(aiJobsTable)
    .where(eq(aiJobsTable.userId, userId))
    .groupBy(aiJobsTable.status)
    .orderBy(asc(aiJobsTable.status));

  const counts = { queued: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row.count;
  }
  res.json({ ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
});

router.post("/ai/backfill", async (_req, res) => {
  const userId = res.locals.user.userId as string;
  const photos = await db.select({ id: photosTable.id })
    .from(photosTable)
    .where(eq(photosTable.userId, userId));

  for (const photo of photos) await enqueueAiJob(userId, photo.id);
  res.status(202).json({ queued: photos.length });
});

export default router;
