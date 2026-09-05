import { Router } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { aiJobsTable } from "@workspace/db";
import { db } from "../db";
import { requireUser } from "../lib/auth";

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

export default router;
