import {
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

export const placesTable = pgTable(
  "places",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    country: text("country"),
    state: text("state"),
    city: text("city"),
    locality: text("locality"),
    district: text("district"),
    postalCode: text("postal_code"),
    formattedName: text("formatted_name"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    placeType: text("place_type").notNull().default("coordinate"),
    landmark: text("landmark"),
    geocoderProvider: text("geocoder_provider"),
    geocoderVersion: text("geocoder_version"),
    geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
    geocodingStatus: text("geocoding_status").notNull().default("pending"),
    geocodingError: text("geocoding_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("places_user_idx").on(table.userId),
    geocodedAtIdx: index("places_geocoded_at_idx").on(table.geocodedAt),
    countryIdx: index("places_country_idx").on(table.country),
    stateIdx: index("places_state_idx").on(table.state),
    cityIdx: index("places_city_idx").on(table.city),
    lookupIdx: uniqueIndex("places_user_lookup_unique").on(table.userId, table.latitude, table.longitude),
  }),
);

export const photoPlacesTable = pgTable(
  "photo_places",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    photoId: text("photo_id").notNull(),
    placeId: text("place_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("photo_places_user_idx").on(table.userId),
    placeIdx: index("photo_places_place_idx").on(table.placeId),
    photoIdx: index("photo_places_photo_idx").on(table.photoId),
    photoPlaceUnique: uniqueIndex("photo_places_user_photo_unique").on(table.userId, table.photoId, table.placeId),
  }),
);

export const geocodingCacheTable = pgTable(
  "geocoding_cache",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
    longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
    country: text("country"),
    state: text("state"),
    city: text("city"),
    locality: text("locality"),
    formattedName: text("formatted_name"),
    provider: text("provider").notNull().default("offline-local"),
    providerVersion: text("provider_version").notNull().default("v1"),
    status: text("status").notNull().default("completed"),
    resultJson: text("result_json"),
    geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userKeyIdx: uniqueIndex("geocoding_cache_user_key_unique").on(table.userId, table.normalizedKey),
    providerIdx: index("geocoding_cache_provider_idx").on(table.provider),
  }),
);

export const geocodingJobsTable = pgTable(
  "geocoding_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    photoId: text("photo_id").notNull(),
    placeId: text("place_id"),
    normalizedKey: text("normalized_key"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    provider: text("provider").notNull().default("offline-local"),
    providerVersion: text("provider_version").notNull().default("v1"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userStatusIdx: index("geocoding_jobs_user_status_idx").on(table.userId, table.status),
    photoIdx: index("geocoding_jobs_photo_idx").on(table.photoId),
    normalizedKeyIdx: index("geocoding_jobs_key_idx").on(table.normalizedKey),
  }),
);

export const insertPlaceSchema = createInsertSchema(placesTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type PlaceRecord = typeof placesTable.$inferSelect;
export type PhotoPlaceRecord = typeof photoPlacesTable.$inferSelect;
export type GeocodingCacheRecord = typeof geocodingCacheTable.$inferSelect;
export type GeocodingJobRecord = typeof geocodingJobsTable.$inferSelect;
export type InsertPlace = z.infer<typeof insertPlaceSchema>;
