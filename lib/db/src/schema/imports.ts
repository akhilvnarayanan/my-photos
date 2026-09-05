import { boolean, bigint, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importJobsTable = pgTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sourcePath: text("source_path").notNull(),
    sourceType: text("source_type").notNull().default("GOOGLE_TAKEOUT"),
    importFolderStructureAsAlbums: boolean("import_folder_structure_as_albums").notNull().default(false),
    status: text("status").notNull(),
    totalFiles: integer("total_files").notNull().default(0),
    processedFiles: integer("processed_files").notNull().default(0),
    successfulFiles: integer("successful_files").notNull().default(0),
    duplicateFiles: integer("duplicate_files").notNull().default(0),
    failedFiles: integer("failed_files").notNull().default(0),
    manifestPhotos: integer("manifest_photos").notNull().default(0),
    manifestVideos: integer("manifest_videos").notNull().default(0),
    manifestTotalBytes: bigint("manifest_total_bytes", { mode: "number" }).notNull().default(0),
    manifestExistingAssets: integer("manifest_existing_assets").notNull().default(0),
    manifestNewAssets: integer("manifest_new_assets").notNull().default(0),
    manifestDuplicateFiles: integer("manifest_duplicate_files").notNull().default(0),
    manifestUnsupportedFiles: integer("manifest_unsupported_files").notNull().default(0),
    manifestAlbums: integer("manifest_albums").notNull().default(0),
    currentFile: text("current_file"),
    errors: text("errors").array().notNull().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("import_jobs_user_idx").on(table.userId),
    statusIdx: index("import_jobs_status_idx").on(table.status),
  }),
);

export const importFilesTable = pgTable(
  "import_files",
  {
    id: text("id").primaryKey(),
    importJobId: text("import_job_id").notNull(),
    sourcePath: text("source_path").notNull(),
    sourceSize: bigint("source_size", { mode: "number" }),
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    destinationPath: text("destination_path"),
    sourceHash: text("source_hash"),
    relativePath: text("relative_path"),
    status: text("status").notNull(),
    error: text("error"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    jobSourceUnique: uniqueIndex("import_files_job_source_unique").on(table.importJobId, table.sourcePath),
  }),
);

export const insertImportJobSchema = createInsertSchema(importJobsTable).omit({
  startedAt: true,
  updatedAt: true,
});
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;
export type ImportJobRecord = typeof importJobsTable.$inferSelect;