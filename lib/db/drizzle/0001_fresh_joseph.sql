ALTER TABLE "ai_worker_status" ADD COLUMN "active_jobs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "photos_user_timeline_idx" ON "photos" USING btree ("user_id","is_trashed","is_archived","capture_date","id");--> statement-breakpoint
CREATE INDEX "photos_user_media_type_idx" ON "photos" USING btree ("user_id","media_type");--> statement-breakpoint
CREATE INDEX "photos_user_favorite_idx" ON "photos" USING btree ("user_id","is_favorite");