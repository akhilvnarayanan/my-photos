import { index, pgTable, text, timestamp, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const albumsTable = pgTable(
  "albums",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userNameUnique: uniqueIndex("albums_user_name_unique").on(table.userId, table.name),
  }),
);

export const albumPhotosTable = pgTable(
  "album_photos",
  {
    albumId: text("album_id").notNull(),
    photoId: text("photo_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.albumId, table.photoId] }),
    photoIdx: index("album_photos_photo_idx").on(table.photoId),
  }),
);

export const insertAlbumSchema = createInsertSchema(albumsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertAlbum = z.infer<typeof insertAlbumSchema>;
export type AlbumRecord = typeof albumsTable.$inferSelect;