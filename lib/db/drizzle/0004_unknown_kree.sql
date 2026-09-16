CREATE TABLE "geocoding_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"normalized_key" text NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"country" text,
	"state" text,
	"city" text,
	"locality" text,
	"formatted_name" text,
	"provider" text DEFAULT 'offline-local' NOT NULL,
	"provider_version" text DEFAULT 'v1' NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"result_json" text,
	"geocoded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocoding_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"photo_id" text NOT NULL,
	"place_id" text,
	"normalized_key" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider" text DEFAULT 'offline-local' NOT NULL,
	"provider_version" text DEFAULT 'v1' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_places" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"photo_id" text NOT NULL,
	"place_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"country" text,
	"state" text,
	"city" text,
	"locality" text,
	"district" text,
	"postal_code" text,
	"formatted_name" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"place_type" text DEFAULT 'coordinate' NOT NULL,
	"landmark" text,
	"geocoder_provider" text,
	"geocoder_version" text,
	"geocoded_at" timestamp with time zone,
	"geocoding_status" text DEFAULT 'pending' NOT NULL,
	"geocoding_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "original_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "timezone_offset_minutes" integer;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "altitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "gps_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "lens_make" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "focal_length" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "aperture" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "shutter_speed" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "iso" integer;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "rotation" integer;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "codec" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "frame_rate" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "color_profile" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "source_path" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "source_provider" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "source_metadata" text;--> statement-breakpoint
CREATE UNIQUE INDEX "geocoding_cache_user_key_unique" ON "geocoding_cache" USING btree ("user_id","normalized_key");--> statement-breakpoint
CREATE INDEX "geocoding_cache_provider_idx" ON "geocoding_cache" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "geocoding_jobs_user_status_idx" ON "geocoding_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "geocoding_jobs_photo_idx" ON "geocoding_jobs" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "geocoding_jobs_key_idx" ON "geocoding_jobs" USING btree ("normalized_key");--> statement-breakpoint
CREATE INDEX "photo_places_user_idx" ON "photo_places" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "photo_places_place_idx" ON "photo_places" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "photo_places_photo_idx" ON "photo_places" USING btree ("photo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_places_user_photo_unique" ON "photo_places" USING btree ("user_id","photo_id","place_id");--> statement-breakpoint
CREATE INDEX "places_user_idx" ON "places" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "places_geocoded_at_idx" ON "places" USING btree ("geocoded_at");--> statement-breakpoint
CREATE INDEX "places_country_idx" ON "places" USING btree ("country");--> statement-breakpoint
CREATE INDEX "places_state_idx" ON "places" USING btree ("state");--> statement-breakpoint
CREATE INDEX "places_city_idx" ON "places" USING btree ("city");--> statement-breakpoint
CREATE UNIQUE INDEX "places_user_lookup_unique" ON "places" USING btree ("user_id","latitude","longitude");