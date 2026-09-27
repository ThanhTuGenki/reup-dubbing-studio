ALTER TYPE "VideoStatus" ADD VALUE 'DELETING';
ALTER TYPE "VideoStatus" ADD VALUE 'DELETE_FAILED';

ALTER TABLE "videos"
  ADD COLUMN "deletion_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN "deletion_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletion_next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "deletion_error_code" TEXT,
  ADD COLUMN "deletion_grace_until" TIMESTAMPTZ(6);

CREATE INDEX "videos_status_deletion_next_attempt_at_idx" ON "videos"("status", "deletion_next_attempt_at");
