import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { aiJobsTable } from "@workspace/db";
import { db } from "../db";
import { requireAuth } from "../middleware/auth";

export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get("/status", async (req, res) => {
  const userId = req.user!.id;
  const rows = await db.select({
    status: aiJobsTable.status,
    count: sql<number>`count(*)::int`,
  }).from(aiJobsTable).where(eq(aiJobsTable.userId, userId)).groupBy(aiJobsTable.status).orderBy(asc(aiJobsTable.status));

  const counts = { queued: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row.count;
  }

  res.json({ ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
});
