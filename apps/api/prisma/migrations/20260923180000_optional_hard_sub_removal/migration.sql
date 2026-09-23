ALTER TABLE "channel_profiles"
ADD COLUMN "remove_hard_sub_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "series_profiles"
ADD COLUMN "remove_hard_sub_override" BOOLEAN;
