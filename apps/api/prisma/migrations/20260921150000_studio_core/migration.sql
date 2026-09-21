-- CreateEnum
CREATE TYPE "CastSheetStatus" AS ENUM ('DRAFT', 'APPROVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "CastRoleKind" AS ENUM ('NARRATOR', 'CHARACTER', 'OTHER');

-- CreateEnum
CREATE TYPE "TranscriptMethod" AS ENUM ('OCR', 'ASR', 'MERGED', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "TranscriptRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SELECTED');

-- CreateEnum
CREATE TYPE "SegmentRevisionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SegmentAudioStatus" AS ENUM ('GENERATING', 'READY', 'SELECTED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewScope" AS ENUM ('CAST', 'SCRIPT', 'TTS', 'RENDER');

-- CreateEnum
CREATE TYPE "ReviewDecisionKind" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED');

-- CreateTable
CREATE TABLE "cast_sheets" (
    "id" UUID NOT NULL,
    "series_profile_id" UUID NOT NULL,
    "status" "CastSheetStatus" NOT NULL DEFAULT 'DRAFT',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cast_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cast_sheet_entries" (
    "id" UUID NOT NULL,
    "cast_sheet_id" UUID NOT NULL,
    "character_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "role_kind" "CastRoleKind" NOT NULL,
    "voice_profile_id" UUID NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cast_sheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_runs" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "method" "TranscriptMethod" NOT NULL,
    "status" "TranscriptRunStatus" NOT NULL,
    "language" TEXT NOT NULL,
    "model_name" TEXT,
    "model_version" TEXT,
    "task_attempt_id" UUID,
    "average_confidence" DECIMAL(6,5),
    "raw_asset_id" UUID,
    "selected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" UUID NOT NULL,
    "transcript_run_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DECIMAL(6,5),
    "bbox" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_segments" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "source_start_ms" INTEGER NOT NULL,
    "source_end_ms" INTEGER NOT NULL,
    "source_segment_id" UUID,
    "current_revision_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_revisions" (
    "id" UUID NOT NULL,
    "video_segment_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "source_text" TEXT NOT NULL,
    "translated_text" TEXT NOT NULL,
    "cast_sheet_entry_id" UUID,
    "voice_profile_id" UUID NOT NULL,
    "target_start_ms" INTEGER NOT NULL,
    "target_end_ms" INTEGER NOT NULL,
    "speech_rate" DECIMAL(5,3) NOT NULL DEFAULT 1,
    "status" "SegmentRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "edit_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_audio_revisions" (
    "id" UUID NOT NULL,
    "video_segment_id" UUID NOT NULL,
    "segment_revision_id" UUID NOT NULL,
    "asset_id" UUID,
    "task_attempt_id" UUID,
    "revision" INTEGER NOT NULL,
    "model_name" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "target_duration_ms" INTEGER NOT NULL,
    "actual_duration_ms" INTEGER,
    "atempo_factor" DECIMAL(6,4),
    "status" "SegmentAudioStatus" NOT NULL DEFAULT 'GENERATING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_audio_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" UUID NOT NULL,
    "video_id" UUID NOT NULL,
    "pipeline_job_id" UUID,
    "scope" "ReviewScope" NOT NULL,
    "subject_version" TEXT NOT NULL,
    "decision" "ReviewDecisionKind" NOT NULL,
    "note" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cast_sheets_series_profile_id_key" ON "cast_sheets"("series_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "cast_sheet_entries_cast_sheet_id_character_key_key" ON "cast_sheet_entries"("cast_sheet_id", "character_key");

-- CreateIndex
CREATE INDEX "transcript_runs_video_id_status_created_at_idx" ON "transcript_runs"("video_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_segments_transcript_run_id_ordinal_key" ON "transcript_segments"("transcript_run_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "video_segments_current_revision_id_key" ON "video_segments"("current_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_segments_video_id_ordinal_key" ON "video_segments"("video_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "segment_revisions_video_segment_id_revision_key" ON "segment_revisions"("video_segment_id", "revision");

-- CreateIndex
CREATE INDEX "segment_audio_revisions_video_segment_id_status_idx" ON "segment_audio_revisions"("video_segment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "segment_audio_revisions_segment_revision_id_revision_key" ON "segment_audio_revisions"("segment_revision_id", "revision");

-- CreateIndex
CREATE INDEX "review_decisions_video_id_scope_decided_at_idx" ON "review_decisions"("video_id", "scope", "decided_at");

-- AddForeignKey
ALTER TABLE "cast_sheets" ADD CONSTRAINT "cast_sheets_series_profile_id_fkey" FOREIGN KEY ("series_profile_id") REFERENCES "series_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cast_sheets" ADD CONSTRAINT "cast_sheets_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cast_sheet_entries" ADD CONSTRAINT "cast_sheet_entries_cast_sheet_id_fkey" FOREIGN KEY ("cast_sheet_id") REFERENCES "cast_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cast_sheet_entries" ADD CONSTRAINT "cast_sheet_entries_voice_profile_id_fkey" FOREIGN KEY ("voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_runs" ADD CONSTRAINT "transcript_runs_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_runs" ADD CONSTRAINT "transcript_runs_task_attempt_id_fkey" FOREIGN KEY ("task_attempt_id") REFERENCES "task_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_runs" ADD CONSTRAINT "transcript_runs_raw_asset_id_fkey" FOREIGN KEY ("raw_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcript_run_id_fkey" FOREIGN KEY ("transcript_run_id") REFERENCES "transcript_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_source_segment_id_fkey" FOREIGN KEY ("source_segment_id") REFERENCES "transcript_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "segment_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_revisions" ADD CONSTRAINT "segment_revisions_video_segment_id_fkey" FOREIGN KEY ("video_segment_id") REFERENCES "video_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_revisions" ADD CONSTRAINT "segment_revisions_cast_sheet_entry_id_fkey" FOREIGN KEY ("cast_sheet_entry_id") REFERENCES "cast_sheet_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_revisions" ADD CONSTRAINT "segment_revisions_voice_profile_id_fkey" FOREIGN KEY ("voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_revisions" ADD CONSTRAINT "segment_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_audio_revisions" ADD CONSTRAINT "segment_audio_revisions_video_segment_id_fkey" FOREIGN KEY ("video_segment_id") REFERENCES "video_segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_audio_revisions" ADD CONSTRAINT "segment_audio_revisions_segment_revision_id_fkey" FOREIGN KEY ("segment_revision_id") REFERENCES "segment_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_audio_revisions" ADD CONSTRAINT "segment_audio_revisions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_audio_revisions" ADD CONSTRAINT "segment_audio_revisions_task_attempt_id_fkey" FOREIGN KEY ("task_attempt_id") REFERENCES "task_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_pipeline_job_id_fkey" FOREIGN KEY ("pipeline_job_id") REFERENCES "pipeline_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_timing_check" CHECK ("start_ms" >= 0 AND "end_ms" > "start_ms");
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_timing_check" CHECK ("source_start_ms" >= 0 AND "source_end_ms" > "source_start_ms");
ALTER TABLE "segment_revisions" ADD CONSTRAINT "segment_revisions_timing_check" CHECK ("target_start_ms" >= 0 AND "target_end_ms" > "target_start_ms");
ALTER TABLE "segment_revisions" ADD CONSTRAINT "segment_revisions_speech_rate_check" CHECK ("speech_rate" BETWEEN 0.5 AND 2.0);
CREATE UNIQUE INDEX "segment_audio_one_selected_idx" ON "segment_audio_revisions"("video_segment_id") WHERE "status" = 'SELECTED';

-- RenameIndex
ALTER INDEX "audit_events_entity_idx" RENAME TO "audit_events_entity_type_entity_id_occurred_at_idx";

-- RenameIndex
ALTER INDEX "series_profiles_channel_status_created_id_idx" RENAME TO "series_profiles_channel_profile_id_status_created_at_id_idx";
