import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const peopleTable = pgTable("people", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name"),
  coverPhotoId: text("cover_photo_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ userIdx: index("people_user_idx").on(table.userId) }));

export const photoFacesTable = pgTable("photo_faces", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  photoId: text("photo_id").notNull(),
  personId: text("person_id"),
  clusterId: text("cluster_id"),
  bboxX: numeric("bbox_x", { precision: 10, scale: 6 }).notNull(),
  bboxY: numeric("bbox_y", { precision: 10, scale: 6 }).notNull(),
  bboxWidth: numeric("bbox_width", { precision: 10, scale: 6 }).notNull(),
  bboxHeight: numeric("bbox_height", { precision: 10, scale: 6 }).notNull(),
  confidence: numeric("confidence", { precision: 8, scale: 6 }),
  embedding: text("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ photoIdx: index("photo_faces_photo_idx").on(table.photoId), personIdx: index("photo_faces_person_idx").on(table.personId) }));

export const aiTagsTable = pgTable("ai_tags", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("object"),
}, (table) => ({ uniqueName: uniqueIndex("ai_tags_user_name_unique").on(table.userId, table.name) }));

export const photoTagsTable = pgTable("photo_tags", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  photoId: text("photo_id").notNull(),
  tagId: text("tag_id").notNull(),
  confidence: numeric("confidence", { precision: 8, scale: 6 }),
}, (table) => ({ uniquePhotoTag: uniqueIndex("photo_tags_photo_tag_unique").on(table.photoId, table.tagId) }));

export const photoTextTable = pgTable("photo_text", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  photoId: text("photo_id").notNull(),
  text: text("text").notNull(),
  language: text("language"),
  confidence: numeric("confidence", { precision: 8, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ photoIdx: index("photo_text_photo_idx").on(table.photoId) }));

export const placesTable = pgTable("places", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  country: text("country"),
  state: text("state"),
  city: text("city"),
  district: text("district"),
  landmark: text("landmark"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ userIdx: index("places_user_idx").on(table.userId) }));

export const photoPlacesTable = pgTable("photo_places", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  photoId: text("photo_id").notNull(),
  placeId: text("place_id").notNull(),
}, (table) => ({ uniquePhotoPlace: uniqueIndex("photo_places_photo_place_unique").on(table.photoId, table.placeId) }));

export const aiJobsTable = pgTable("ai_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  photoId: text("photo_id").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  requestedFeatures: text("requested_features").notNull().default("all"),
  modelVersion: text("model_version"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ uniquePhoto: uniqueIndex("ai_jobs_photo_unique").on(table.photoId), statusIdx: index("ai_jobs_status_idx").on(table.status) }));

export const aiSettingsTable = pgTable("ai_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  workerUrl: text("worker_url"),
  visionModel: text("vision_model"),
  faceModel: text("face_model"),
  ocrEnabled: boolean("ocr_enabled").notNull().default(true),
  objectDetectionEnabled: boolean("object_detection_enabled").notNull().default(true),
  faceRecognitionEnabled: boolean("face_recognition_enabled").notNull().default(true),
  maxConcurrency: integer("max_concurrency").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ uniqueUser: uniqueIndex("ai_settings_user_unique").on(table.userId) }));

export const insertAiJobSchema = createInsertSchema(aiJobsTable).omit({ createdAt: true });
export type InsertAiJob = z.infer<typeof insertAiJobSchema>;
export type AiJob = typeof aiJobsTable.$inferSelect;
