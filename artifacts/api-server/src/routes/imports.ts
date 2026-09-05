import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "node:crypto";
import path from "node:path";
import { createWriteStream, promises as fs } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, importFilesTable, importJobsTable, photosTable } from "@workspace/db";
import { CancelImportParams, CancelImportResponse, ConfirmImportParams, ConfirmImportResponse, GetImportParams, GetImportResponse, ListImportsResponse, PauseImportParams, PauseImportResponse, ResumeImportParams, ResumeImportResponse, RetryImportParams, RetryImportResponse, StartImportBody, StartImportResponse } from "@workspace/api-zod";
import { requireUser } from "../lib/auth";
import { runImportJob, scanImportJob } from "../lib/importer";
import { enqueueAiJobsForPhotos } from "../lib/ai-jobs";
import { isManagedPath, storageRoot } from "../lib/media";

const router: IRouter = Router();
router.use("/imports", requireUser);
const MAX_BROWSER_UPLOAD_BYTES = Number(process.env.MAX_BROWSER_UPLOAD_BYTES ?? 20 * 1024 ** 3);

async function queueImportedAiJobs(jobId: string) {
  const [job] = await db.select({ userId: importJobsTable.userId }).from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  if (!job) return;
  const photos = await db.select({ id: photosTable.id }).from(photosTable).where(sql`${photosTable.userId} = ${job.userId} and ${photosTable.id} in (select asset_id from asset_sources where import_job_id = ${jobId})`);
  if (photos.length) await enqueueAiJobsForPhotos(job.userId, photos.map((photo) => photo.id));
}

async function scanThenImport(jobId: string) {
  await scanImportJob(jobId);
  const [scanned] = await db.select().from(importJobsTable).where(eq(importJobsTable.id, jobId)).limit(1);
  if (scanned?.status !== "ready") return;
  const [job] = await db.update(importJobsTable).set({ status: "importing", updatedAt: new Date() }).where(and(eq(importJobsTable.id, jobId), eq(importJobsTable.status, "ready"))).returning();
  if (job) void runImportJob(job.id).then(() => queueImportedAiJobs(job.id));
}

function importResponse(job: typeof importJobsTable.$inferSelect) {
  return { id: job.id, sourcePath: job.sourcePath, status: job.status as "scanning" | "ready" | "importing" | "paused" | "completed" | "cancelled" | "failed", sourceType: job.sourceType as "GOOGLE_TAKEOUT" | "LOCAL_FOLDER" | "EXTERNAL_HDD" | "BROWSER_UPLOAD" | "PHONE", importFolderStructureAsAlbums: job.importFolderStructureAsAlbums, totalFiles: job.totalFiles, processedFiles: job.processedFiles, successfulFiles: job.successfulFiles, duplicateFiles: job.duplicateFiles, failedFiles: job.failedFiles, currentFile: job.currentFile, errors: job.errors, startedAt: job.startedAt, updatedAt: job.updatedAt, manifest: { totalFiles: job.totalFiles, photos: job.manifestPhotos, videos: job.manifestVideos, totalSize: job.manifestTotalBytes, existingAssets: job.manifestExistingAssets, newAssets: job.manifestNewAssets, duplicateFiles: job.manifestDuplicateFiles, unsupportedFiles: job.manifestUnsupportedFiles, albums: job.manifestAlbums } };
}

router.get("/imports", async (_req, res): Promise<void> => {
  const rows = await db.select().from(importJobsTable).where(eq(importJobsTable.userId, res.locals.user.userId)).orderBy(desc(importJobsTable.updatedAt)).limit(20);
  res.json(ListImportsResponse.parse(rows.map(importResponse)));
});

router.post("/imports", async (req, res): Promise<void> => {
  const parsed = StartImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const sourcePath = path.resolve(parsed.data.sourcePath);
  if (isManagedPath(sourcePath)) { res.status(400).json({ error: "The managed photo storage directory cannot be used as an import source" }); return; }
  try { if (!(await fs.stat(sourcePath)).isDirectory()) throw new Error("not a directory"); } catch { res.status(400).json({ error: "Import source must be an existing directory visible to the API server" }); return; }
  const [job] = await db.insert(importJobsTable).values({ id: crypto.randomUUID(), userId: res.locals.user.userId, sourcePath, sourceType: parsed.data.sourceType, importFolderStructureAsAlbums: parsed.data.importFolderStructureAsAlbums ?? false, status: "scanning" }).returning();
  void scanImportJob(job.id);
  res.status(202).json(StartImportResponse.parse(importResponse(job)));
});

router.post("/imports/upload", async (req, res): Promise<void> => {
  const encodedName = req.header("X-File-Name");
  if (!encodedName) { res.status(400).json({ error: "X-File-Name is required" }); return; }
  let filename: string;
  try { filename = path.basename(decodeURIComponent(encodedName)).replaceAll("\0", "").trim(); } catch { res.status(400).json({ error: "Invalid file name" }); return; }
  if (!filename || filename === "." || filename === "..") { res.status(400).json({ error: "Invalid file name" }); return; }
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_BROWSER_UPLOAD_BYTES) { res.status(413).json({ error: "Browser upload is larger than the configured limit" }); return; }
  const jobId = crypto.randomUUID();
  const uploadRoot = path.join(storageRoot, "uploads", jobId);
  const sourcePath = path.join(uploadRoot, filename);
  let bytes = 0;
  const limiter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(bytes > MAX_BROWSER_UPLOAD_BYTES ? new Error("Browser upload is larger than the configured limit") : null, chunk); } });
  try { await fs.mkdir(uploadRoot, { recursive: true }); await pipeline(req, limiter, createWriteStream(sourcePath, { flags: "wx" })); } catch (error) { await fs.rm(uploadRoot, { recursive: true, force: true }); res.status(String(error).includes("configured limit") ? 413 : 400).json({ error: String(error) }); return; }
  const [job] = await db.insert(importJobsTable).values({ id: jobId, userId: res.locals.user.userId, sourcePath: uploadRoot, sourceType: "BROWSER_UPLOAD", status: "scanning" }).returning();
  void scanThenImport(job.id);
  res.status(202).json(StartImportResponse.parse(importResponse(job)));
});

router.get("/imports/:importId", async (req, res): Promise<void> => {
  const parsed = GetImportParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [job] = await db.select().from(importJobsTable).where(and(eq(importJobsTable.id, parsed.data.importId), eq(importJobsTable.userId, res.locals.user.userId))).limit(1);
  if (!job) { res.status(404).json({ error: "Import not found" }); return; }
  res.json(GetImportResponse.parse(importResponse(job)));
});

async function setImportStatus(req: Request, res: Response, status: string, schema: typeof PauseImportResponse | typeof ResumeImportResponse | typeof CancelImportResponse): Promise<void> {
  const parsed = (status === "paused" ? PauseImportParams : status === "importing" ? ResumeImportParams : CancelImportParams).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [job] = await db.update(importJobsTable).set({ status, updatedAt: new Date() }).where(and(eq(importJobsTable.id, parsed.data.importId), eq(importJobsTable.userId, res.locals.user.userId))).returning();
  if (!job) { res.status(404).json({ error: "Import not found" }); return; }
  if (status === "importing") void runImportJob(job.id).then(() => queueImportedAiJobs(job.id));
  res.json(schema.parse(importResponse(job)));
}

router.post("/imports/:importId/pause", async (req, res): Promise<void> => { await setImportStatus(req, res, "paused", PauseImportResponse); });
router.post("/imports/:importId/resume", async (req, res): Promise<void> => { await setImportStatus(req, res, "importing", ResumeImportResponse); });
router.post("/imports/:importId/cancel", async (req, res): Promise<void> => { await setImportStatus(req, res, "cancelled", CancelImportResponse); });

router.post("/imports/:importId/confirm", async (req, res): Promise<void> => {
  const parsed = ConfirmImportParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [job] = await db.update(importJobsTable).set({ status: "importing", updatedAt: new Date() }).where(and(eq(importJobsTable.id, parsed.data.importId), eq(importJobsTable.userId, res.locals.user.userId), eq(importJobsTable.status, "ready"))).returning();
  if (!job) { res.status(409).json({ error: "Import is not ready to confirm" }); return; }
  void runImportJob(job.id).then(() => queueImportedAiJobs(job.id));
  res.status(202).json(ConfirmImportResponse.parse(importResponse(job)));
});

router.post("/imports/:importId/retry", async (req, res): Promise<void> => {
  const parsed = RetryImportParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [current] = await db.select().from(importJobsTable).where(and(eq(importJobsTable.id, parsed.data.importId), eq(importJobsTable.userId, res.locals.user.userId))).limit(1);
  if (!current || !["completed", "failed"].includes(current.status) || current.failedFiles === 0) { res.status(409).json({ error: "This import has no failed files to retry" }); return; }
  await db.update(importFilesTable).set({ status: "discovered", error: null, processedAt: null }).where(and(eq(importFilesTable.importJobId, current.id), eq(importFilesTable.status, "failed")));
  const [job] = await db.update(importJobsTable).set({ status: "importing", processedFiles: sql`greatest(${importJobsTable.processedFiles} - ${current.failedFiles}, 0)`, failedFiles: 0, currentFile: null, updatedAt: new Date() }).where(eq(importJobsTable.id, current.id)).returning();
  void runImportJob(job.id).then(() => queueImportedAiJobs(job.id));
  res.status(202).json(RetryImportResponse.parse(importResponse(job)));
});

export default router;
