import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const photosTable = pgTable(
  "photos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    filename: text("filename").notNull(),
    originalPath: text("original_path").notNull(),
    thumbnailSmallPath: text("thumbnail_small_path"),
    thumbnailMediumPath: text("thumbnail_medium_path"),
    mimeType: text("mime_type").notNull(),
    mediaType: text("media_type").notNull(),
    fileSize: bigint("file_size", { mode: "number" }).notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    captureDate: timestamp("capture_date", { withTimezone: true }).notNull(),
    captureDateSource: text("capture_date_source").notNull().default("UNKNOWN"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    hash: text("hash").notNull(),
    description: text("description"),
    cameraMake: text("camera_make"),
    cameraModel: text("camera_model"),
    lensModel: text("lens_model"),
    orientation: integer("orientation"),
    duration: integer("duration"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    isTrashed: boolean("is_trashed").notNull().default(false),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    captureDateIdx: index("photos_capture_date_idx").on(table.captureDate),
    hashIdx: index("photos_hash_idx").on(table.hash),
    filenameIdx: index("photos_filename_idx").on(table.filename),
    mimeTypeIdx: index("photos_mime_type_idx").on(table.mimeType),
    latitudeIdx: index("photos_latitude_idx").on(table.latitude),
    longitudeIdx: index("photos_longitude_idx").on(table.longitude),
    favoriteIdx: index("photos_favorite_idx").on(table.isFavorite),
    archivedIdx: index("photos_archived_idx").on(table.isArchived),
    trashedIdx: index("photos_trashed_idx").on(table.isTrashed),
    userCaptureDateIdx: index("photos_user_capture_date_idx").on(table.userId, table.captureDate),
    userHashIdx: uniqueIndex("photos_user_hash_unique").on(table.userId, table.hash),
  }),
);

export const insertPhotoSchema = createInsertSchema(photosTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type PhotoRecord = typeof photosTable.$inferSelect;