import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { photosTable, photoTextTable } from "@workspace/db/schema";
import { db } from "../db";

const execFileAsync = promisify(execFile);
const OCR_LANGUAGE = process.env.AI_OCR_LANGUAGE ?? "eng";
const OCR_TIMEOUT_MS = Number(process.env.AI_OCR_TIMEOUT_MS ?? 120000);

function storagePath(path: string) {
  if (path.startsWith("/photos/")) return path;
  if (path.startsWith("/")) return path;
  return `/photos/${path.replace(/^\\+/, "")}`;
}

export async function processOcrJob(userId: string, photoId: string) {
  const [photo] = await db.select({
    id: photosTable.id,
    originalPath: photosTable.originalPath,
    mediaType: photosTable.mediaType,
    mimeType: photosTable.mimeType,
  }).from(photosTable).where(and(eq(photosTable.id, photoId), eq(photosTable.userId, userId))).limit(1);

  if (!photo) throw new Error("Photo not found");
  if (photo.mediaType !== "photo" || !photo.mimeType.startsWith("image/")) return { extracted: false, reason: "not-an-image" };

  const inputPath = storagePath(photo.originalPath);
  const { stdout } = await execFileAsync("tesseract", [inputPath, "stdout", "-l", OCR_LANGUAGE, "--psm", "3"], {
    timeout: OCR_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const text = stdout.trim();

  await db.delete(photoTextTable).where(and(eq(photoTextTable.photoId, photoId), eq(photoTextTable.userId, userId)));
  if (!text) return { extracted: false, reason: "no-text" };

  await db.insert(photoTextTable).values({
    id: randomUUID(),
    userId,
    photoId,
    text,
    language: OCR_LANGUAGE,
    confidence: null,
  });

  return { extracted: true, characters: text.length };
}
