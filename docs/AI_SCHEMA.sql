-- Reference schema for the local AI metadata layer.
-- Drizzle TypeScript definitions are the application source of truth.
-- Keep AI data separate from original photo records so it can be rebuilt.

CREATE TABLE people (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  name text,
  cover_photo_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE photo_faces (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  photo_id text NOT NULL,
  person_id text,
  cluster_id text,
  bbox_x numeric(10,6) NOT NULL,
  bbox_y numeric(10,6) NOT NULL,
  bbox_width numeric(10,6) NOT NULL,
  bbox_height numeric(10,6) NOT NULL,
  confidence numeric(8,6),
  embedding text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_tags (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'object',
  UNIQUE(user_id, name)
);

CREATE TABLE photo_tags (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  photo_id text NOT NULL,
  tag_id text NOT NULL,
  confidence numeric(8,6),
  UNIQUE(photo_id, tag_id)
);

CREATE TABLE photo_text (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  photo_id text NOT NULL,
  text text NOT NULL,
  language text,
  confidence numeric(8,6),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE places (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  country text,
  state text,
  city text,
  district text,
  landmark text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE photo_places (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  photo_id text NOT NULL,
  place_id text NOT NULL,
  UNIQUE(photo_id, place_id)
);

CREATE TABLE ai_jobs (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  photo_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  requested_features text NOT NULL DEFAULT 'all',
  model_version text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(photo_id)
);

CREATE TABLE ai_settings (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  worker_url text,
  vision_model text,
  face_model text,
  ocr_enabled boolean NOT NULL DEFAULT true,
  object_detection_enabled boolean NOT NULL DEFAULT true,
  face_recognition_enabled boolean NOT NULL DEFAULT true,
  max_concurrency integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
