import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetSourcesTable = pgTable(
  "asset_sources",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    importJobId: text("import_job_id"),
    sourceType: text("source_type").notNull(),
    sourcePath: text("source_path").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourceHash: text("source_hash").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    assetIdx: index("asset_sources_asset_idx").on(table.assetId),
    hashIdx: index("asset_sources_hash_idx").on(table.sourceHash),
    importJobIdx: index("asset_sources_import_job_idx").on(table.importJobId),
    sourceIdentityUnique: uniqueIndex("asset_sources_identity_unique").on(table.assetId, table.sourceHash, table.sourcePath),
  }),
);

export const insertAssetSourceSchema = createInsertSchema(assetSourcesTable).omit({
  importedAt: true,
});
export type InsertAssetSource = z.infer<typeof insertAssetSourceSchema>;
export type AssetSourceRecord = typeof assetSourcesTable.$inferSelect;