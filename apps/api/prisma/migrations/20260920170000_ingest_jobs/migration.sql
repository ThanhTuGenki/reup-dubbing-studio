CREATE TYPE "VideoStatus" AS ENUM ('INGEST_QUEUED', 'INGESTING', 'INGESTED', 'PROCESSING', 'AWAITING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISHED', 'FAILED', 'ARCHIVED');
CREATE TYPE "PipelineJobKind" AS ENUM ('INGEST', 'FULL_PIPELINE', 'RERENDER', 'REGENERATE_CONTENT');
CREATE TYPE "PipelineJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "PipelineTaskType" AS ENUM ('DOWNLOAD', 'DESUB', 'TRANSCRIBE_OCR', 'TRANSCRIBE_ASR', 'MERGE_TRANSCRIPT', 'TRANSLATE', 'ASSIGN_CAST', 'GENERATE_INITIAL_TTS', 'WAIT_FOR_REVIEW', 'REGENERATE_SEGMENT', 'SEPARATE_AUDIO', 'RENDER', 'EXPORT_SRT', 'UPLOAD_OUTPUTS', 'GENERATE_PUBLISH_PACKAGE');
CREATE TYPE "ResourceClass" AS ENUM ('IO', 'CPU', 'GPU_BATCH', 'GPU_TTS_INTERACTIVE', 'CONTROL_PLANE', 'HUMAN_REVIEW');
CREATE TYPE "PipelineTaskStatus" AS ENUM ('BLOCKED', 'READY', 'LEASED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'WORKER', 'SYSTEM');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "display_name" TEXT NOT NULL,
  "email" TEXT,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_normalized_key" ON "users" (lower("email")) WHERE "email" IS NOT NULL;

INSERT INTO "users" ("id", "display_name", "updated_at")
VALUES ('01994429-ec00-7000-8000-000000000002', 'Workspace owner', CURRENT_TIMESTAMP);

CREATE TABLE "videos" (
  "id" UUID NOT NULL,
  "source_content_id" UUID NOT NULL,
  "channel_profile_id" UUID NOT NULL,
  "series_profile_id" UUID,
  "status" "VideoStatus" NOT NULL DEFAULT 'INGEST_QUEUED',
  "source_language" TEXT NOT NULL,
  "target_language" TEXT NOT NULL,
  "display_title" TEXT,
  "ingested_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_jobs" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "kind" "PipelineJobKind" NOT NULL,
  "status" "PipelineJobStatus" NOT NULL DEFAULT 'QUEUED',
  "pipeline_version" TEXT NOT NULL,
  "profile_snapshot" JSONB NOT NULL,
  "requested_outputs" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "failure_code" TEXT,
  "failure_detail_safe" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "pipeline_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_tasks" (
  "id" UUID NOT NULL,
  "pipeline_job_id" UUID NOT NULL,
  "task_type" "PipelineTaskType" NOT NULL,
  "resource_class" "ResourceClass" NOT NULL,
  "status" "PipelineTaskStatus" NOT NULL DEFAULT 'BLOCKED',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "ready_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "input_manifest" JSONB NOT NULL,
  "configuration" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "pipeline_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL,
  "actor_type" "AuditActorType" NOT NULL,
  "actor_id" UUID,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID,
  "request_id" UUID,
  "before_safe" JSONB,
  "after_safe" JSONB,
  "metadata_safe" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "videos_source_content_id_channel_profile_id_key" ON "videos"("source_content_id", "channel_profile_id");
CREATE INDEX "videos_status_updated_at_id_idx" ON "videos"("status", "updated_at" DESC, "id");
CREATE INDEX "pipeline_jobs_status_priority_created_at_idx" ON "pipeline_jobs"("status", "priority" DESC, "created_at");
CREATE INDEX "pipeline_jobs_video_id_status_idx" ON "pipeline_jobs"("video_id", "status");
CREATE UNIQUE INDEX "pipeline_jobs_one_active_ingest_per_video" ON "pipeline_jobs"("video_id") WHERE "kind" = 'INGEST' AND "status" IN ('QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW');
CREATE INDEX "pipeline_tasks_queue_idx" ON "pipeline_tasks"("status", "resource_class", "priority" DESC, "ready_at", "id");
CREATE INDEX "pipeline_tasks_pipeline_job_id_status_idx" ON "pipeline_tasks"("pipeline_job_id", "status");
CREATE INDEX "audit_events_entity_idx" ON "audit_events"("entity_type", "entity_id", "occurred_at");
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

ALTER TABLE "videos" ADD CONSTRAINT "videos_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "source_contents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "videos" ADD CONSTRAINT "videos_channel_profile_id_fkey" FOREIGN KEY ("channel_profile_id") REFERENCES "channel_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "videos" ADD CONSTRAINT "videos_series_profile_id_fkey" FOREIGN KEY ("series_profile_id") REFERENCES "series_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "videos" ADD CONSTRAINT "videos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pipeline_tasks" ADD CONSTRAINT "pipeline_tasks_pipeline_job_id_fkey" FOREIGN KEY ("pipeline_job_id") REFERENCES "pipeline_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
