import { boolean, index, integer, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiFeatures = ["OCR", "OBJECT_DETECTION", "FACE_DETECTION", "SCENE_RECOGNITION"] as const;
export type AiFeature = (typeof aiFeatures)[number];

export const aiJobsTable = pgTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    photoId: text("photo_id").notNull(),
    feature: text("feature").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    modelVersion: text("model_version"),
    requestedFeatures: text("requested_features").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userStatusIdx: index("ai_jobs_user_status_idx").on(table.userId, table.status),
    userFeatureStatusIdx: index("ai_jobs_user_feature_status_idx").on(table.userId, table.feature, table.status),
    photoIdx: index("ai_jobs_photo_idx").on(table.photoId),
    userPhotoFeatureUnique: uniqueIndex("ai_jobs_user_photo_feature_unique").on(table.userId, table.photoId, table.feature),
  }),
);

export const aiSettingsTable = pgTable("ai_settings", {
  userId: text("user_id").primaryKey(),
  processingEnabled: boolean("processing_enabled").notNull().default(true),
  processingPaused: boolean("processing_paused").notNull().default(false),
  ocrEnabled: boolean("ocr_enabled").notNull().default(true),
  objectDetectionEnabled: boolean("object_detection_enabled").notNull().default(false),
  faceDetectionEnabled: boolean("face_detection_enabled").notNull().default(false),
  sceneRecognitionEnabled: boolean("scene_recognition_enabled").notNull().default(false),
  maxConcurrency: integer("max_concurrency").notNull().default(1),
  processingPriority: text("processing_priority").notNull().default("normal"),
  computeDevice: text("compute_device").notNull().default("auto"),
  visionModel: text("vision_model"),
  ocrLanguage: text("ocr_language").notNull().default("eng"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiWorkerStatusTable = pgTable(
  "ai_worker_status",
  {
    workerId: text("worker_id").primaryKey(),
    workerRole: text("worker_role").notNull().default("api"),
    status: text("status").notNull().default("stopped"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    currentJobId: text("current_job_id"),
    currentFeature: text("current_feature"),
    currentPhotoId: text("current_photo_id"),
    workerVersion: text("worker_version").notNull().default("unknown"),
    activeJobs: integer("active_jobs").notNull().default(0),
    jobsCompleted: integer("jobs_completed").notNull().default(0),
    jobsFailed: integer("jobs_failed").notNull().default(0),
    currentError: text("current_error"),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    heartbeatIdx: index("ai_worker_status_heartbeat_idx").on(table.heartbeatAt),
    statusIdx: index("ai_worker_status_status_idx").on(table.status),
  }),
);

export const photoTextTable = pgTable(
  "photo_text",
  {
    photoId: text("photo_id").primaryKey(),
    userId: text("user_id").notNull(),
    text: text("text").notNull().default(""),
    confidence: real("confidence"),
    language: text("language").notNull().default("eng"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("photo_text_user_idx").on(table.userId),
    textIdx: index("photo_text_text_idx").on(table.text),
    searchIdx: index("photo_text_search_idx").using("gin", sql`to_tsvector('simple', coalesce(${table.text}, ''))`),
  }),
);

export const insertAiJobSchema = createInsertSchema(aiJobsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertAiJob = z.infer<typeof insertAiJobSchema>;
export type AiJobRecord = typeof aiJobsTable.$inferSelect;
export type AiSettingsRecord = typeof aiSettingsTable.$inferSelect;
export type PhotoTextRecord = typeof photoTextTable.$inferSelect;