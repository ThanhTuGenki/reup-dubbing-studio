CREATE TYPE "TaskExecutorKind" AS ENUM ('CONTROL_PLANE', 'WORKER');
CREATE TYPE "TaskAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED');

ALTER TABLE "pipeline_tasks"
  ADD COLUMN "progress_bps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progress_detail_safe" TEXT,
  ADD CONSTRAINT "pipeline_tasks_progress_bps_check" CHECK ("progress_bps" BETWEEN 0 AND 10000);

CREATE TABLE "task_attempts" (
  "id" UUID NOT NULL, "pipeline_task_id" UUID NOT NULL, "attempt_number" INTEGER NOT NULL,
  "executor_kind" "TaskExecutorKind" NOT NULL, "executor_instance_id" TEXT NOT NULL,
  "worker_session_id" UUID, "status" "TaskAttemptStatus" NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL, "finished_at" TIMESTAMPTZ(6),
  "queue_wait_ms" BIGINT, "execution_ms" BIGINT, "gpu_active_ms" BIGINT,
  "input_bytes" BIGINT, "output_bytes" BIGINT, "exit_code" INTEGER,
  "error_code" TEXT, "error_detail_safe" TEXT, "metrics_safe" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "task_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_attempts_attempt_number_check" CHECK ("attempt_number" >= 1),
  CONSTRAINT "task_attempts_finished_at_check" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at"),
  CONSTRAINT "task_attempts_worker_session_check" CHECK (("executor_kind" = 'WORKER' AND "worker_session_id" IS NOT NULL) OR ("executor_kind" = 'CONTROL_PLANE' AND "worker_session_id" IS NULL))
);
CREATE UNIQUE INDEX "task_attempts_pipeline_task_id_attempt_number_key" ON "task_attempts"("pipeline_task_id", "attempt_number");
CREATE INDEX "task_attempts_pipeline_task_id_started_at_idx" ON "task_attempts"("pipeline_task_id", "started_at");

CREATE TABLE "task_leases" (
  "id" UUID NOT NULL, "pipeline_task_id" UUID NOT NULL, "task_attempt_id" UUID NOT NULL,
  "executor_kind" "TaskExecutorKind" NOT NULL, "executor_instance_id" TEXT NOT NULL,
  "worker_session_id" UUID, "fencing_token" BIGINT NOT NULL,
  "leased_at" TIMESTAMPTZ(6) NOT NULL, "renewed_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL, "released_at" TIMESTAMPTZ(6), "release_reason" TEXT,
  CONSTRAINT "task_leases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_leases_time_check" CHECK ("renewed_at" >= "leased_at" AND "expires_at" > "renewed_at" AND ("released_at" IS NULL OR "released_at" >= "leased_at")),
  CONSTRAINT "task_leases_worker_session_check" CHECK (("executor_kind" = 'WORKER' AND "worker_session_id" IS NOT NULL) OR ("executor_kind" = 'CONTROL_PLANE' AND "worker_session_id" IS NULL))
);
CREATE UNIQUE INDEX "task_leases_pipeline_task_id_fencing_token_key" ON "task_leases"("pipeline_task_id", "fencing_token");
CREATE UNIQUE INDEX "task_leases_one_active_per_task" ON "task_leases"("pipeline_task_id") WHERE "released_at" IS NULL;
CREATE INDEX "task_leases_expires_at_idx" ON "task_leases"("expires_at");

CREATE TABLE "workflow_events" (
  "id" UUID NOT NULL, "video_id" UUID, "pipeline_job_id" UUID, "pipeline_task_id" UUID,
  "task_attempt_id" UUID, "event_type" TEXT NOT NULL, "from_status" TEXT, "to_status" TEXT,
  "actor_type" "AuditActorType" NOT NULL, "actor_id" UUID, "message_safe" TEXT,
  "payload_safe" JSONB NOT NULL DEFAULT '{}', "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workflow_events_pipeline_job_id_occurred_at_id_idx" ON "workflow_events"("pipeline_job_id", "occurred_at", "id");

CREATE TABLE "outbox_messages" (
  "id" UUID NOT NULL, "aggregate_type" TEXT NOT NULL, "aggregate_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL, "payload_safe" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempt_count" INTEGER NOT NULL DEFAULT 0, "locked_by" TEXT, "locked_until" TIMESTAMPTZ(6),
  "published_at" TIMESTAMPTZ(6), "last_error_safe" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_messages_published_at_available_at_id_idx" ON "outbox_messages"("published_at", "available_at", "id");
CREATE INDEX "outbox_messages_locked_until_idx" ON "outbox_messages"("locked_until");

ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_pipeline_task_id_fkey" FOREIGN KEY ("pipeline_task_id") REFERENCES "pipeline_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_pipeline_task_id_fkey" FOREIGN KEY ("pipeline_task_id") REFERENCES "pipeline_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_task_attempt_id_fkey" FOREIGN KEY ("task_attempt_id") REFERENCES "task_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_pipeline_job_id_fkey" FOREIGN KEY ("pipeline_job_id") REFERENCES "pipeline_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_pipeline_task_id_fkey" FOREIGN KEY ("pipeline_task_id") REFERENCES "pipeline_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_task_attempt_id_fkey" FOREIGN KEY ("task_attempt_id") REFERENCES "task_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
