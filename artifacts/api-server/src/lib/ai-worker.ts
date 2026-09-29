import crypto from "node:crypto";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { and, desc, eq, sql } from "drizzle-orm";
import { aiSettingsTable, aiWorkerStatusTable, db, photosTable } from "@workspace/db";
import type { AiJobRecord } from "@workspace/db";
import { logger } from "./logger";
import {
  claimNextOcrJob,
  completeOcrJob,
  failAiJob,
  recoverStaleAiJobs,
} from "./ai-jobs";
import { isManagedPath } from "./media";

const execFileAsync = promisify(execFile);
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const OCR_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

export type WorkerStatusValue = "running" | "idle" | "stopped" | "stale" | "unavailable";

type WorkerState = {
  status: "running" | "stopped" | "unavailable";
  lastHeartbeat: Date | null;
  currentJobId: string | null;
  currentFeature: string | null;
  currentPhotoId: string | null;
  workerVersion: string;
  activeJobs: number;
  jobsCompleted: number;
  jobsFailed: number;
  processingStartedAt: Date | null;
  lastError: string | null;
};

const WORKER_VERSION = process.env.AI_WORKER_VERSION ?? "local-tesseract-v1";

const state: WorkerState = {
  status: "stopped",
  lastHeartbeat: null,
  currentJobId: null,
  currentFeature: null,
  currentPhotoId: null,
  workerVersion: WORKER_VERSION,
  activeJobs: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  processingStartedAt: null,
  lastError: null,
};

const activeJobs = new Set<string>();
let heartbeatTimer: NodeJS.Timeout | undefined;
let polling = false;

async function persistWorkerStatus(status: "running" | "idle" | "stopped" | "unavailable") {
  await db.insert(aiWorkerStatusTable).values({
    workerId: workerId(),
    workerRole: process.env.AI_WORKER_ONLY === "true" ? "dedicated" : "api",
    status,
    heartbeatAt: new Date(),
    currentJobId: state.currentJobId,
    currentFeature: state.currentFeature,
    currentPhotoId: state.currentPhotoId,
    workerVersion: state.workerVersion,
    activeJobs: state.activeJobs,
    jobsCompleted: state.jobsCompleted,
    jobsFailed: state.jobsFailed,
    currentError: state.lastError,
    processingStartedAt: state.processingStartedAt,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: aiWorkerStatusTable.workerId,
    set: {
      status,
      workerRole: process.env.AI_WORKER_ONLY === "true" ? "dedicated" : "api",
      heartbeatAt: new Date(),
      currentJobId: state.currentJobId,
      currentFeature: state.currentFeature,
      currentPhotoId: state.currentPhotoId,
      workerVersion: state.workerVersion,
      activeJobs: state.activeJobs,
      jobsCompleted: state.jobsCompleted,
      jobsFailed: state.jobsFailed,
      currentError: state.lastError,
      processingStartedAt: state.processingStartedAt,
      updatedAt: new Date(),
    },
  });
}

function envNumber(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

function workerId() {
  return process.env.AI_WORKER_ID ?? `${os.hostname()}-${process.pid}`;
}

function languageFor(value: string | null | undefined) {
  return value && /^[A-Za-z0-9_]+$/.test(value) ? value : "eng";
}

function isOcrImage(filePath: string) {
  return OCR_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function prepareOcrInput(source: string) {
  const extension = path.extname(source).toLowerCase();
  if (extension !== ".heic" && extension !== ".heif") return { filePath: source, cleanup: async () => {} };

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "my-photos-ocr-"));
  const destination = path.join(directory, `${crypto.randomUUID()}.png`);
  try {
    await execFileAsync("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-frames:v", "1", destination], {
      timeout: envNumber("AI_OCR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000),
    });
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    filePath: destination,
    cleanup: () => fs.rm(directory, { recursive: true, force: true }),
  };
}

function parseTsv(output: string) {
  const lines = output.split(/\r?\n/);
  const textParts: string[] = [];
  const confidences: number[] = [];
  for (const line of lines.slice(1)) {
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    const text = columns[11]?.trim();
    const confidence = Number(columns[10]);
    if (text) textParts.push(text);
    if (text && Number.isFinite(confidence) && confidence >= 0) confidences.push(confidence);
  }
  return {
    text: textParts.join(" ").replace(/\s+/g, " ").trim(),
    confidence: confidences.length
      ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100) / 100
      : null,
  };
}

async function runTesseract(filePath: string, language: string) {
  const { stdout } = await execFileAsync("tesseract", [
    filePath,
    "stdout",
    "--psm",
    "3",
    "-l",
    language,
    "tsv",
  ], {
    timeout: envNumber("AI_OCR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000),
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseTsv(stdout);
}

async function getConcurrency() {
  const [row] = await db.select({
    maxConcurrency: sql<number>`coalesce(max(${aiSettingsTable.maxConcurrency}), 1)`,
  }).from(aiSettingsTable).where(and(
    eq(aiSettingsTable.processingEnabled, true),
    eq(aiSettingsTable.ocrEnabled, true),
  ));
  const configured = envNumber("AI_WORKER_CONCURRENCY", 1, 1);
  return Math.max(1, Math.min(8, configured, Number(row?.maxConcurrency ?? 1)));
}

async function processJob(job: AiJobRecord) {
  state.currentJobId = job.id;
  state.currentFeature = job.feature;
  state.currentPhotoId = job.photoId;
  state.processingStartedAt = new Date();
  await persistWorkerStatus("running");
  let succeeded = false;
  try {
    const [photo] = await db.select({
      originalPath: photosTable.originalPath,
      mimeType: photosTable.mimeType,
      mediaType: photosTable.mediaType,
    }).from(photosTable).where(and(eq(photosTable.id, job.photoId), eq(photosTable.userId, job.userId))).limit(1);
    if (!photo || photo.mediaType !== "photo") {
      await completeOcrJob(job, "", null, "eng");
      return;
    }
    if (!isManagedPath(photo.originalPath) || !isOcrImage(photo.originalPath)) {
      throw new Error(`Unsupported OCR image format: ${photo.mimeType}`);
    }
    await fs.access(photo.originalPath);
    const settings = await db.select({ ocrLanguage: aiSettingsTable.ocrLanguage })
      .from(aiSettingsTable).where(eq(aiSettingsTable.userId, job.userId)).limit(1);
    const language = languageFor(settings[0]?.ocrLanguage);
    const input = await prepareOcrInput(photo.originalPath);
    try {
      const result = await runTesseract(input.filePath, language);
      await completeOcrJob(job, result.text, result.confidence, language);
      state.lastError = null;
      succeeded = true;
    } finally {
      await input.cleanup();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message.slice(0, 4000);
    state.jobsFailed += 1;
    await failAiJob(job, message);
    logger.error({ err: error, jobId: job.id, photoId: job.photoId }, "OCR job failed");
  } finally {
    if (succeeded) state.jobsCompleted += 1;
    state.currentJobId = null;
    state.currentFeature = null;
    state.currentPhotoId = null;
    state.processingStartedAt = null;
  }
}

async function poll() {
  if (polling || state.status !== "running") return;
  polling = true;
  state.lastHeartbeat = new Date();
  await persistWorkerStatus("running");
  try {
    await recoverStaleAiJobs();
    const concurrency = await getConcurrency();
    while (activeJobs.size < concurrency) {
      const job = await claimNextOcrJob();
      if (!job) break;
      activeJobs.add(job.id);
      state.activeJobs = activeJobs.size;
      void processJob(job).finally(async () => {
        activeJobs.delete(job.id);
        state.activeJobs = activeJobs.size;
        await persistWorkerStatus(activeJobs.size ? "running" : "idle");
      });
    }
    if (!activeJobs.size) await persistWorkerStatus("idle");
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "AI worker poll failed");
    await persistWorkerStatus("running");
  } finally {
    state.lastHeartbeat = new Date();
    state.activeJobs = activeJobs.size;
    polling = false;
  }
}

export function getAiWorkerState(): WorkerState {
  return { ...state };
}

export async function getDedicatedWorkerStatus() {
  const [row] = await db.select().from(aiWorkerStatusTable)
    .where(eq(aiWorkerStatusTable.workerRole, "dedicated"))
    .orderBy(desc(aiWorkerStatusTable.heartbeatAt))
    .limit(1);
  if (!row) {
    return {
      status: "unavailable" as WorkerStatusValue,
      lastHeartbeat: null,
      currentJobId: null,
      currentFeature: null,
      currentPhotoId: null,
      workerVersion: null,
      activeJobs: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      processingStartedAt: null,
      lastError: null,
    };
  }
  const staleAfter = Math.max(10_000, envNumber("AI_WORKER_POLL_MS", DEFAULT_POLL_MS, 250) * 3);
  const isStale = !row.heartbeatAt || Date.now() - row.heartbeatAt.getTime() > staleAfter;
  return {
    status: (isStale ? "stale" : row.status) as WorkerStatusValue,
    lastHeartbeat: row.heartbeatAt,
    currentJobId: row.currentJobId,
    currentFeature: row.currentFeature,
    currentPhotoId: row.currentPhotoId,
    workerVersion: row.workerVersion,
    activeJobs: row.activeJobs,
    jobsCompleted: row.jobsCompleted,
    jobsFailed: row.jobsFailed,
    processingStartedAt: row.processingStartedAt,
    lastError: row.currentError,
  };
}

export function startAiWorker() {
  if (heartbeatTimer) return;
  if (process.env.AI_WORKER_DISABLED === "true") {
    state.status = "unavailable";
    state.lastHeartbeat = new Date();
    void persistWorkerStatus("unavailable").catch((error) => logger.error({ error }, "Failed to persist disabled worker status"));
    logger.info("AI worker disabled by configuration");
    return;
  }
  state.status = "running";
  state.lastHeartbeat = new Date();
  void persistWorkerStatus("running").catch((error) => logger.error({ error }, "Failed to persist worker status"));
  void poll();
  heartbeatTimer = setInterval(() => void poll(), envNumber("AI_WORKER_POLL_MS", DEFAULT_POLL_MS, 250));
  if (process.env.AI_WORKER_ONLY !== "true") heartbeatTimer.unref();
  logger.info({ workerId: workerId() }, "Local OCR worker started");
}