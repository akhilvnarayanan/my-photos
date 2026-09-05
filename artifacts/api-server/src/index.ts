import app from "./app";
import { logger } from "./lib/logger";
import { db, importJobsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { runImportJob, scanImportJob } from "./lib/importer";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void db.select({ id: importJobsTable.id }).from(importJobsTable)
    .where(inArray(importJobsTable.status, ["scanning", "importing"]))
    .then(async (jobs) => {
      await Promise.all(jobs.map(async (job) => {
        const [fullJob] = await db.select().from(importJobsTable).where(eq(importJobsTable.id, job.id)).limit(1);
        if (fullJob?.status === "scanning") return scanImportJob(job.id);
        return runImportJob(job.id);
      }));
    })
    .catch((error) => logger.error({ error }, "Failed to resume imports"));
});
