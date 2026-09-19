CREATE TYPE "ProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "VoiceMode" AS ENUM ('SINGLE', 'DUAL', 'MULTI_AUTO');
CREATE TYPE "TimingPolicy" AS ENUM ('PRESERVE_SEGMENT', 'FIT_SEGMENT', 'ALLOW_DRIFT');
CREATE TYPE "PublishingPlatform" AS ENUM ('YOUTUBE', 'FACEBOOK');
CREATE TYPE "VoiceProfileStatus" AS ENUM ('DRAFT', 'READY', 'BLOCKED_LICENSE', 'ARCHIVED');
CREATE TYPE "AssetStorageBackend" AS ENUM ('LOCAL', 'R2', 'S3');
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'AVAILABLE', 'DELETING', 'DELETED', 'FAILED');
CREATE TYPE "ChannelProfileAssetRole" AS ENUM ('INTRO', 'OUTRO', 'LOGO', 'WATERMARK');
CREATE TYPE "SeriesProfileAssetRole" AS ENUM ('MASK_REFERENCE_FRAME');

CREATE TABLE "voice_profiles" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "language" TEXT NOT NULL,
  "status" "VoiceProfileStatus" NOT NULL DEFAULT 'DRAFT',
  "commercial_use_allowed" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "voice_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "channel_profiles" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "normalized_name" TEXT NOT NULL,
  "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT', "target_language" TEXT NOT NULL,
  "default_voice_profile_id" UUID, "default_voice_mode" "VoiceMode" NOT NULL DEFAULT 'SINGLE',
  "subtitle_language" TEXT NOT NULL, "subtitle_filename_rule" TEXT NOT NULL,
  "subtitle_max_line_length" INTEGER, "tts_speed" DECIMAL(5,3) NOT NULL DEFAULT 1,
  "timing_policy" "TimingPolicy" NOT NULL DEFAULT 'FIT_SEGMENT',
  "output_16x9_enabled" BOOLEAN NOT NULL DEFAULT true,
  "output_9x16_enabled" BOOLEAN NOT NULL DEFAULT false,
  "content_voice_rules" JSONB NOT NULL DEFAULT '{}', "content_cta_template" TEXT,
  "content_metadata_template" JSONB NOT NULL DEFAULT '{}',
  "content_base_keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "channel_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "channel_profiles_subtitle_max_line_length_check" CHECK ("subtitle_max_line_length" IS NULL OR "subtitle_max_line_length" BETWEEN 1 AND 500),
  CONSTRAINT "channel_profiles_tts_speed_check" CHECK ("tts_speed" BETWEEN 0.5 AND 2.0),
  CONSTRAINT "channel_profiles_default_voice_profile_id_fkey" FOREIGN KEY ("default_voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "channel_profiles_active_name_key" ON "channel_profiles" ("normalized_name") WHERE "status" <> 'ARCHIVED';
CREATE INDEX "channel_profiles_status_created_at_id_idx" ON "channel_profiles" ("status", "created_at", "id");

CREATE TABLE "publishing_destinations" (
  "id" UUID NOT NULL, "channel_profile_id" UUID NOT NULL,
  "platform" "PublishingPlatform" NOT NULL, "external_id" TEXT,
  "display_name" TEXT NOT NULL, "normalized_name" TEXT NOT NULL,
  "is_required" BOOLEAN NOT NULL DEFAULT false, "is_active" BOOLEAN NOT NULL DEFAULT true,
  "platform_config" JSONB NOT NULL DEFAULT '{}', "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "publishing_destinations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "publishing_destinations_channel_profile_id_fkey" FOREIGN KEY ("channel_profile_id") REFERENCES "channel_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "publishing_destinations_channel_profile_id_idx" ON "publishing_destinations" ("channel_profile_id");
CREATE UNIQUE INDEX "publishing_destinations_external_key" ON "publishing_destinations" ("channel_profile_id", "platform", "external_id") WHERE "external_id" IS NOT NULL;
CREATE UNIQUE INDEX "publishing_destinations_name_key" ON "publishing_destinations" ("channel_profile_id", "platform", "normalized_name") WHERE "external_id" IS NULL;

CREATE TABLE "series_profiles" (
  "id" UUID NOT NULL, "channel_profile_id" UUID NOT NULL, "name" TEXT NOT NULL,
  "normalized_name" TEXT NOT NULL, "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT',
  "target_language_override" TEXT, "default_voice_profile_override_id" UUID,
  "voice_mode_override" "VoiceMode", "subtitle_language_override" TEXT,
  "subtitle_filename_rule_override" TEXT, "subtitle_max_line_length_override" INTEGER,
  "tts_speed_override" DECIMAL(5,3), "timing_policy_override" "TimingPolicy",
  "output_16x9_override" BOOLEAN, "output_9x16_override" BOOLEAN,
  "mask_x" DECIMAL(9,8), "mask_y" DECIMAL(9,8), "mask_width" DECIMAL(9,8), "mask_height" DECIMAL(9,8),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "series_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "series_profiles_channel_profile_id_fkey" FOREIGN KEY ("channel_profile_id") REFERENCES "channel_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "series_profiles_default_voice_profile_override_id_fkey" FOREIGN KEY ("default_voice_profile_override_id") REFERENCES "voice_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "series_profiles_subtitle_max_line_length_check" CHECK ("subtitle_max_line_length_override" IS NULL OR "subtitle_max_line_length_override" BETWEEN 1 AND 500),
  CONSTRAINT "series_profiles_tts_speed_check" CHECK ("tts_speed_override" IS NULL OR "tts_speed_override" BETWEEN 0.5 AND 2.0),
  CONSTRAINT "series_profiles_mask_complete_check" CHECK (("mask_x" IS NULL AND "mask_y" IS NULL AND "mask_width" IS NULL AND "mask_height" IS NULL) OR ("mask_x" IS NOT NULL AND "mask_y" IS NOT NULL AND "mask_width" IS NOT NULL AND "mask_height" IS NOT NULL)),
  CONSTRAINT "series_profiles_mask_bounds_check" CHECK ("mask_x" IS NULL OR ("mask_x" >= 0 AND "mask_y" >= 0 AND "mask_width" > 0 AND "mask_height" > 0 AND "mask_x" + "mask_width" <= 1 AND "mask_y" + "mask_height" <= 1))
);
CREATE UNIQUE INDEX "series_profiles_active_name_key" ON "series_profiles" ("channel_profile_id", "normalized_name") WHERE "status" <> 'ARCHIVED';
CREATE INDEX "series_profiles_channel_status_created_id_idx" ON "series_profiles" ("channel_profile_id", "status", "created_at", "id");

CREATE TABLE "assets" (
  "id" UUID NOT NULL, "storage_backend" "AssetStorageBackend" NOT NULL,
  "bucket" TEXT, "object_key" TEXT NOT NULL, "file_name" TEXT NOT NULL,
  "status" "AssetStatus" NOT NULL DEFAULT 'PENDING', "checksum_sha256" TEXT,
  "byte_size" BIGINT, "content_type" TEXT, "width" INTEGER, "height" INTEGER,
  "uploaded_at" TIMESTAMPTZ(6), "verified_at" TIMESTAMPTZ(6),
  "metadata" JSONB NOT NULL DEFAULT '{}', "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assets_checksum_check" CHECK ("checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "assets_byte_size_check" CHECK ("byte_size" IS NULL OR "byte_size" > 0)
);
CREATE UNIQUE INDEX "assets_storage_backend_bucket_object_key_key" ON "assets" ("storage_backend", "bucket", "object_key");
CREATE INDEX "assets_status_created_at_idx" ON "assets" ("status", "created_at");

CREATE TABLE "channel_profile_assets" (
  "id" UUID NOT NULL, "channel_profile_id" UUID NOT NULL, "asset_id" UUID NOT NULL,
  "role" "ChannelProfileAssetRole" NOT NULL, "revision" INTEGER NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "channel_profile_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "channel_profile_assets_channel_profile_id_fkey" FOREIGN KEY ("channel_profile_id") REFERENCES "channel_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_profile_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_profile_assets_channel_profile_id_role_revision_key" UNIQUE ("channel_profile_id", "role", "revision")
);
CREATE INDEX "channel_profile_assets_asset_id_idx" ON "channel_profile_assets" ("asset_id");
CREATE UNIQUE INDEX "channel_profile_assets_current_key" ON "channel_profile_assets" ("channel_profile_id", "role") WHERE "is_current" = true;

CREATE TABLE "series_profile_assets" (
  "id" UUID NOT NULL, "series_profile_id" UUID NOT NULL, "asset_id" UUID NOT NULL,
  "role" "SeriesProfileAssetRole" NOT NULL, "revision" INTEGER NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "series_profile_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "series_profile_assets_series_profile_id_fkey" FOREIGN KEY ("series_profile_id") REFERENCES "series_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "series_profile_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "series_profile_assets_series_profile_id_role_revision_key" UNIQUE ("series_profile_id", "role", "revision")
);
CREATE INDEX "series_profile_assets_asset_id_idx" ON "series_profile_assets" ("asset_id");
CREATE UNIQUE INDEX "series_profile_assets_current_key" ON "series_profile_assets" ("series_profile_id", "role") WHERE "is_current" = true;
