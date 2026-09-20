CREATE TYPE "VoiceLicenseKind" AS ENUM (
  'OWNED_RECORDING', 'AUTHORIZED_COMMERCIAL', 'CC_BY', 'CC_BY_NC', 'CUSTOM', 'UNKNOWN'
);

ALTER TABLE "voice_profiles" RENAME COLUMN "language" TO "primary_language";
ALTER TABLE "voice_profiles"
  ADD COLUMN "normalized_name" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "license_kind" "VoiceLicenseKind" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "license_reference" TEXT,
  ADD COLUMN "source_reference" TEXT;

UPDATE "voice_profiles"
SET "normalized_name" = lower(btrim("name"));

UPDATE "voice_profiles"
SET "status" = 'BLOCKED_LICENSE', "commercial_use_allowed" = false
WHERE "status" = 'READY';

ALTER TABLE "voice_profiles" ALTER COLUMN "normalized_name" SET NOT NULL;
CREATE UNIQUE INDEX "voice_profiles_normalized_name_key" ON "voice_profiles"("normalized_name");
CREATE INDEX "voice_profiles_status_primary_language_created_at_id_idx"
  ON "voice_profiles"("status", "primary_language", "created_at", "id");
CREATE INDEX "voice_profiles_tags_idx" ON "voice_profiles" USING GIN ("tags");

CREATE TABLE "voice_profile_samples" (
  "id" UUID NOT NULL,
  "voice_profile_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "language" TEXT NOT NULL,
  "transcript" TEXT NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_profile_samples_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_profile_samples_transcript_check" CHECK (char_length(btrim("transcript")) BETWEEN 1 AND 1000),
  CONSTRAINT "voice_profile_samples_duration_check" CHECK ("duration_ms" BETWEEN 3000 AND 10000),
  CONSTRAINT "voice_profile_samples_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "voice_profile_samples_voice_profile_id_fkey"
    FOREIGN KEY ("voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "voice_profile_samples_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "voice_profile_samples_voice_profile_id_language_revision_key"
  ON "voice_profile_samples"("voice_profile_id", "language", "revision");
CREATE UNIQUE INDEX "voice_profile_samples_one_current_language_idx"
  ON "voice_profile_samples"("voice_profile_id", "language") WHERE "is_current" = true;
CREATE INDEX "voice_profile_samples_voice_profile_id_language_is_current_idx"
  ON "voice_profile_samples"("voice_profile_id", "language", "is_current");
CREATE INDEX "voice_profile_samples_asset_id_idx" ON "voice_profile_samples"("asset_id");
