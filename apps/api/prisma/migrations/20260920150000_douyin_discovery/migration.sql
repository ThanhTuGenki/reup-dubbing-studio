-- CreateEnum
CREATE TYPE "SourcePlatform" AS ENUM ('DOUYIN', 'BILIBILI', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CAPTCHA_REQUIRED', 'INVALID', 'REVOKED');

-- CreateEnum
CREATE TYPE "DiscoveryMode" AS ENUM ('JINGXUAN', 'CATEGORY', 'COURSE', 'CREATOR', 'MIX', 'SEARCH_VIDEO', 'SEARCH_USER', 'VIDEO_URL', 'WATCHLIST');

-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SourceContentType" AS ENUM ('VIDEO', 'LONG_VIDEO', 'NOTE', 'SLIDES', 'ARTICLE', 'LIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('AVAILABLE', 'PRIVATE', 'REMOVED', 'REGION_BLOCKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MediaCandidateRole" AS ENUM ('COVER', 'COVER_169', 'ORIGIN_COVER', 'PLAYBACK', 'PLAYBACK_H265', 'AUDIO', 'OTHER');

-- CreateEnum
CREATE TYPE "WatchlistStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CREDENTIAL_REQUIRED', 'FAILED');

-- CreateTable
CREATE TABLE "source_accounts" (
    "id" UUID NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'INVALID',
    "last_validated_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "cooldown_until" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_credentials" (
    "id" UUID NOT NULL,
    "source_account_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "encryption_key_id" TEXT NOT NULL,
    "encrypted_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_creators" (
    "id" UUID NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_secure_id" TEXT,
    "nickname" TEXT,
    "avatar_url" TEXT,
    "profile_url" TEXT,
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_categories" (
    "id" UUID NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "external_key" TEXT NOT NULL,
    "slug" TEXT,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "source_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_contents" (
    "id" UUID NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "external_id" TEXT NOT NULL,
    "encoded_external_id" TEXT,
    "creator_id" UUID,
    "content_type" "SourceContentType" NOT NULL,
    "external_type_code" TEXT,
    "title" TEXT,
    "description" TEXT,
    "canonical_url" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "availability" "Availability" NOT NULL DEFAULT 'UNKNOWN',
    "is_ingest_eligible" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
    "metadata_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_media_candidates" (
    "id" UUID NOT NULL,
    "source_content_id" UUID NOT NULL,
    "role" "MediaCandidateRole" NOT NULL,
    "canonical_url" TEXT,
    "url_fingerprint" TEXT NOT NULL,
    "requires_refresh" BOOLEAN NOT NULL DEFAULT false,
    "codec" TEXT,
    "container" TEXT,
    "bitrate" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "source_media_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_metric_snapshots" (
    "id" UUID NOT NULL,
    "source_content_id" UUID NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "play_count" BIGINT,
    "digg_count" BIGINT,
    "comment_count" BIGINT,
    "collect_count" BIGINT,
    "share_count" BIGINT,
    "forward_count" BIGINT,
    "live_watch_count" BIGINT,

    CONSTRAINT "content_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_content_categories" (
    "source_content_id" UUID NOT NULL,
    "source_category_id" UUID NOT NULL,
    "relation_type" TEXT NOT NULL,

    CONSTRAINT "source_content_categories_pkey" PRIMARY KEY ("source_content_id","source_category_id","relation_type")
);

-- CreateTable
CREATE TABLE "discovery_runs" (
    "id" UUID NOT NULL,
    "source_account_id" UUID NOT NULL,
    "mode" "DiscoveryMode" NOT NULL,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'QUEUED',
    "input" TEXT,
    "query" TEXT,
    "category_id" UUID,
    "watchlist_id" UUID,
    "provider_cursor" JSONB,
    "requested_limit" INTEGER,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_counts" JSONB NOT NULL DEFAULT '{}',
    "response_log_id" TEXT,
    "error_code" TEXT,
    "error_detail_safe" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_items" (
    "id" UUID NOT NULL,
    "discovery_run_id" UUID NOT NULL,
    "source_content_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "page_index" INTEGER NOT NULL,
    "category_id" UUID,
    "is_top_card" BOOLEAN NOT NULL DEFAULT false,
    "is_big_card" BOOLEAN NOT NULL DEFAULT false,
    "provider_reason" TEXT,
    "discovered_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discovery_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" UUID NOT NULL,
    "source_account_id" UUID NOT NULL,
    "mode" "DiscoveryMode" NOT NULL,
    "resolved_input" JSONB NOT NULL,
    "resolved_identity" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "WatchlistStatus" NOT NULL DEFAULT 'ACTIVE',
    "schedule_interval_min" INTEGER NOT NULL,
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "cursor" JSONB,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_raw_events" (
    "id" UUID NOT NULL,
    "discovery_run_id" UUID NOT NULL,
    "endpoint_kind" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "payload_checksum" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "source_raw_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_accounts_platform_created_at_id_idx" ON "source_accounts"("platform", "created_at", "id");

-- CreateIndex
CREATE INDEX "source_credentials_source_account_id_kind_revoked_at_idx" ON "source_credentials"("source_account_id", "kind", "revoked_at");

CREATE UNIQUE INDEX "source_credentials_one_current_kind_idx"
ON "source_credentials"("source_account_id", "kind") WHERE "revoked_at" IS NULL;

-- CreateIndex
CREATE INDEX "source_creators_platform_last_seen_at_idx" ON "source_creators"("platform", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_creators_platform_external_id_key" ON "source_creators"("platform", "external_id");

CREATE UNIQUE INDEX "source_creators_platform_external_secure_id_idx"
ON "source_creators"("platform", "external_secure_id") WHERE "external_secure_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "source_categories_platform_kind_is_active_idx" ON "source_categories"("platform", "kind", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "source_categories_platform_kind_external_key_key" ON "source_categories"("platform", "kind", "external_key");

-- CreateIndex
CREATE INDEX "source_contents_platform_published_at_id_idx" ON "source_contents"("platform", "published_at", "id");

-- CreateIndex
CREATE INDEX "source_contents_creator_id_published_at_id_idx" ON "source_contents"("creator_id", "published_at", "id");

-- CreateIndex
CREATE INDEX "source_contents_availability_last_seen_at_idx" ON "source_contents"("availability", "last_seen_at");

-- CreateIndex
CREATE INDEX "source_contents_content_type_published_at_idx" ON "source_contents"("content_type", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_contents_platform_external_id_key" ON "source_contents"("platform", "external_id");

-- CreateIndex
CREATE INDEX "source_media_candidates_source_content_id_role_observed_at_idx" ON "source_media_candidates"("source_content_id", "role", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_media_candidates_source_content_id_role_url_fingerpr_key" ON "source_media_candidates"("source_content_id", "role", "url_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "content_metric_snapshots_source_content_id_captured_at_key" ON "content_metric_snapshots"("source_content_id", "captured_at");

-- CreateIndex
CREATE INDEX "discovery_runs_source_account_id_status_created_at_idx" ON "discovery_runs"("source_account_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "discovery_runs_watchlist_id_status_created_at_idx" ON "discovery_runs"("watchlist_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "discovery_items_discovery_run_id_rank_id_idx" ON "discovery_items"("discovery_run_id", "rank", "id");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_items_discovery_run_id_source_content_id_key" ON "discovery_items"("discovery_run_id", "source_content_id");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_items_discovery_run_id_rank_key" ON "discovery_items"("discovery_run_id", "rank");

-- CreateIndex
CREATE INDEX "watchlists_status_next_run_at_idx" ON "watchlists"("status", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "watchlists_source_account_id_mode_resolved_identity_key" ON "watchlists"("source_account_id", "mode", "resolved_identity");

CREATE UNIQUE INDEX "discovery_runs_one_active_watchlist_idx"
ON "discovery_runs"("watchlist_id") WHERE "watchlist_id" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING');

-- CreateIndex
CREATE INDEX "source_raw_events_expires_at_idx" ON "source_raw_events"("expires_at");

-- AddForeignKey
ALTER TABLE "source_credentials" ADD CONSTRAINT "source_credentials_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "source_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_categories" ADD CONSTRAINT "source_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "source_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_contents" ADD CONSTRAINT "source_contents_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "source_creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_media_candidates" ADD CONSTRAINT "source_media_candidates_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "source_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_metric_snapshots" ADD CONSTRAINT "content_metric_snapshots_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "source_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_content_categories" ADD CONSTRAINT "source_content_categories_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "source_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_content_categories" ADD CONSTRAINT "source_content_categories_source_category_id_fkey" FOREIGN KEY ("source_category_id") REFERENCES "source_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "source_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "source_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_items" ADD CONSTRAINT "discovery_items_discovery_run_id_fkey" FOREIGN KEY ("discovery_run_id") REFERENCES "discovery_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_items" ADD CONSTRAINT "discovery_items_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "source_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_items" ADD CONSTRAINT "discovery_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "source_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "source_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_raw_events" ADD CONSTRAINT "source_raw_events_discovery_run_id_fkey" FOREIGN KEY ("discovery_run_id") REFERENCES "discovery_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "source_categories" ("id", "platform", "external_key", "slug", "label", "kind", "is_active", "last_seen_at", "metadata") VALUES
('01a0bcd9-77b8-75fa-bf7a-fde3f120f67d', 'DOUYIN', '0', 'all', 'Tất cả', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77b9-70b8-821e-eecbc5212980', 'DOUYIN', '100000', 'course', 'Khóa học công khai', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77ba-78f8-ba7b-83a2ca920b20', 'DOUYIN', '300205', 'game', 'Game', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77bb-71d1-a543-051871824f15', 'DOUYIN', '300206', 'acg', 'ACG', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77bc-70c2-9d47-1726d397fd4c', 'DOUYIN', '300209', 'music', 'Âm nhạc', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77bd-7f68-9dae-057b8e5a4276', 'DOUYIN', '300204', 'food', 'Ẩm thực', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77be-77cc-8bb4-c8e7d6400aba', 'DOUYIN', '300213', 'knowledge', 'Kiến thức', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77bf-7f36-b517-71aae4660239', 'DOUYIN', '300207', 'sports', 'Thể thao', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c0-793a-ba9e-0a7b863db8b0', 'DOUYIN', '300214', 'theater', 'Tiểu phẩm', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c1-74e5-b16e-59eb10b7dc5b', 'DOUYIN', '300215', 'film', 'Phim ảnh', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c2-7c6a-9b1a-6457c700c731', 'DOUYIN', '300216', 'vlog', 'Vlog', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c3-7a77-96a0-03b5ece42388', 'DOUYIN', '300217', 'child', 'Cha mẹ/trẻ em', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c4-7072-af7d-ace21a10f954', 'DOUYIN', '300218', 'car', 'Ô tô', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c5-7257-a11d-c0efd46c0c62', 'DOUYIN', '300219', 'agriculture', 'Nông nghiệp', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c6-7174-b693-5f3f10754748', 'DOUYIN', '300220', 'animal', 'Động vật', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c7-7936-ad0e-3363ea10938f', 'DOUYIN', '300221', 'travel', 'Du lịch', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}'),
('01a0bcd9-77c8-72c0-acd7-fb963e835109', 'DOUYIN', '300222', 'beauty', 'Làm đẹp/thời trang', 'JINGXUAN_CATEGORY', true, CURRENT_TIMESTAMP, '{"source":"fallback-seed"}');
