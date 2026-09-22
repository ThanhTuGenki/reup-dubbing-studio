ALTER TYPE "ReviewScope" ADD VALUE 'PUBLISH_CONTENT';

CREATE TYPE "ReviewGateMode" AS ENUM ('MANUAL_REQUIRED', 'NOT_REQUIRED');

CREATE TABLE "review_policies" (
  "id" UUID NOT NULL,
  "channel_profile_id" UUID,
  "series_profile_id" UUID,
  "cast_gate" "ReviewGateMode",
  "script_gate" "ReviewGateMode",
  "tts_gate" "ReviewGateMode",
  "render_gate" "ReviewGateMode",
  "publish_content_gate" "ReviewGateMode",
  "auto_request_render" BOOLEAN,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "review_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_policies_owner_check" CHECK (
    ("channel_profile_id" IS NOT NULL)::INTEGER + ("series_profile_id" IS NOT NULL)::INTEGER = 1
  ),
  CONSTRAINT "review_policies_channel_complete_check" CHECK (
    "channel_profile_id" IS NULL OR (
      "cast_gate" IS NOT NULL AND "script_gate" IS NOT NULL AND
      "tts_gate" IS NOT NULL AND "render_gate" IS NOT NULL AND
      "publish_content_gate" IS NOT NULL AND "auto_request_render" IS NOT NULL
    )
  ),
  CONSTRAINT "review_policies_version_check" CHECK ("version" >= 1),
  CONSTRAINT "review_policies_channel_profile_id_fkey" FOREIGN KEY ("channel_profile_id") REFERENCES "channel_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "review_policies_series_profile_id_fkey" FOREIGN KEY ("series_profile_id") REFERENCES "series_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "review_policies_channel_profile_id_key" ON "review_policies"("channel_profile_id");
CREATE UNIQUE INDEX "review_policies_series_profile_id_key" ON "review_policies"("series_profile_id");

INSERT INTO "review_policies" (
  "id", "channel_profile_id", "cast_gate", "script_gate", "tts_gate",
  "render_gate", "publish_content_gate", "auto_request_render", "updated_at"
)
SELECT
  (substr(md5('review-policy-channel:' || "id"::text), 1, 8) || '-' ||
   substr(md5('review-policy-channel:' || "id"::text), 9, 4) || '-7' ||
   substr(md5('review-policy-channel:' || "id"::text), 14, 3) || '-8' ||
   substr(md5('review-policy-channel:' || "id"::text), 18, 3) || '-' ||
   substr(md5('review-policy-channel:' || "id"::text), 21, 12))::uuid,
  "id",
  CASE WHEN "default_voice_mode" = 'MULTI_AUTO' THEN 'MANUAL_REQUIRED'::"ReviewGateMode" ELSE 'NOT_REQUIRED'::"ReviewGateMode" END,
  'MANUAL_REQUIRED', 'MANUAL_REQUIRED', 'MANUAL_REQUIRED', 'MANUAL_REQUIRED', false,
  CURRENT_TIMESTAMP
FROM "channel_profiles";

INSERT INTO "review_policies" ("id", "series_profile_id", "updated_at")
SELECT
  (substr(md5('review-policy-series:' || "id"::text), 1, 8) || '-' ||
   substr(md5('review-policy-series:' || "id"::text), 9, 4) || '-7' ||
   substr(md5('review-policy-series:' || "id"::text), 14, 3) || '-8' ||
   substr(md5('review-policy-series:' || "id"::text), 18, 3) || '-' ||
   substr(md5('review-policy-series:' || "id"::text), 21, 12))::uuid,
  "id", CURRENT_TIMESTAMP
FROM "series_profiles";
