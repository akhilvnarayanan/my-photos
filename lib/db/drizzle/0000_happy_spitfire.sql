CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photos" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"original_path" text NOT NULL,
	"thumbnail_small_path" text,
	"thumbnail_medium_path" text,
	"mime_type" text NOT NULL,
	"media_type" text NOT NULL,
	"file_size" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"capture_date" timestamp with time zone NOT NULL,
	"capture_date_source" text DEFAULT 'UNKNOWN' NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"hash" text NOT NULL,
	"description" text,
	"camera_make" text,
	"camera_model" text,
	"lens_model" text,
	"orientation" integer,
	"duration" integer,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_trashed" boolean DEFAULT false NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "album_photos" (
	"album_id" text NOT NULL,
	"photo_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_photos_album_id_photo_id_pk" PRIMARY KEY("album_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "albums" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_files" (
	"id" text PRIMARY KEY NOT NULL,
	"import_job_id" text NOT NULL,
	"source_path" text NOT NULL,
	"source_size" bigint,
	"source_modified_at" timestamp with time zone,
	"destination_path" text,
	"source_hash" text,
	"relative_path" text,
	"status" text NOT NULL,
	"error" text,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_path" text NOT NULL,
	"source_type" text DEFAULT 'GOOGLE_TAKEOUT' NOT NULL,
	"import_folder_structure_as_albums" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"processed_files" integer DEFAULT 0 NOT NULL,
	"successful_files" integer DEFAULT 0 NOT NULL,
	"duplicate_files" integer DEFAULT 0 NOT NULL,
	"failed_files" integer DEFAULT 0 NOT NULL,
	"manifest_photos" integer DEFAULT 0 NOT NULL,
	"manifest_videos" integer DEFAULT 0 NOT NULL,
	"manifest_total_bytes" bigint DEFAULT 0 NOT NULL,
	"manifest_existing_assets" integer DEFAULT 0 NOT NULL,
	"manifest_new_assets" integer DEFAULT 0 NOT NULL,
	"manifest_duplicate_files" integer DEFAULT 0 NOT NULL,
	"manifest_unsupported_files" integer DEFAULT 0 NOT NULL,
	"manifest_albums" integer DEFAULT 0 NOT NULL,
	"current_file" text,
	"errors" text[] DEFAULT '{}' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"import_job_id" text,
	"source_type" text NOT NULL,
	"source_path" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_hash" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"photo_id" text NOT NULL,
	"feature" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"model_version" text,
	"requested_features" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"processing_enabled" boolean DEFAULT true NOT NULL,
	"processing_paused" boolean DEFAULT false NOT NULL,
	"ocr_enabled" boolean DEFAULT true NOT NULL,
	"object_detection_enabled" boolean DEFAULT false NOT NULL,
	"face_detection_enabled" boolean DEFAULT false NOT NULL,
	"scene_recognition_enabled" boolean DEFAULT false NOT NULL,
	"max_concurrency" integer DEFAULT 1 NOT NULL,
	"processing_priority" text DEFAULT 'normal' NOT NULL,
	"compute_device" text DEFAULT 'auto' NOT NULL,
	"vision_model" text,
	"ocr_language" text DEFAULT 'eng' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_worker_status" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'stopped' NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"current_job_id" text,
	"current_feature" text,
	"current_photo_id" text,
	"worker_version" text DEFAULT 'unknown' NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"jobs_failed" integer DEFAULT 0 NOT NULL,
	"current_error" text,
	"processing_started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photo_text" (
	"photo_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"confidence" real,
	"language" text DEFAULT 'eng' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_capture_date_idx" ON "photos" USING btree ("capture_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_hash_idx" ON "photos" USING btree ("hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_filename_idx" ON "photos" USING btree ("filename");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_mime_type_idx" ON "photos" USING btree ("mime_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_latitude_idx" ON "photos" USING btree ("latitude");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_longitude_idx" ON "photos" USING btree ("longitude");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_favorite_idx" ON "photos" USING btree ("is_favorite");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_archived_idx" ON "photos" USING btree ("is_archived");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_trashed_idx" ON "photos" USING btree ("is_trashed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photos_user_capture_date_idx" ON "photos" USING btree ("user_id","capture_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "photos_user_hash_unique" ON "photos" USING btree ("user_id","hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "album_photos_photo_idx" ON "album_photos" USING btree ("photo_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "albums_user_name_unique" ON "albums" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_files_job_source_unique" ON "import_files" USING btree ("import_job_id","source_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_jobs_user_idx" ON "import_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_jobs_status_idx" ON "import_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_sources_asset_idx" ON "asset_sources" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_sources_hash_idx" ON "asset_sources" USING btree ("source_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_sources_import_job_idx" ON "asset_sources" USING btree ("import_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_sources_identity_unique" ON "asset_sources" USING btree ("asset_id","source_hash","source_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_jobs_user_status_idx" ON "ai_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_jobs_user_feature_status_idx" ON "ai_jobs" USING btree ("user_id","feature","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_jobs_photo_idx" ON "ai_jobs" USING btree ("photo_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_jobs_user_photo_feature_unique" ON "ai_jobs" USING btree ("user_id","photo_id","feature");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_worker_status_heartbeat_idx" ON "ai_worker_status" USING btree ("heartbeat_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_worker_status_status_idx" ON "ai_worker_status" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_text_user_idx" ON "photo_text" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "photo_text_text_idx" ON "photo_text" USING btree ("text");