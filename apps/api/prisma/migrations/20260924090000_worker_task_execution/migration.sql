ALTER TABLE "pipeline_tasks"
  ADD COLUMN "required_capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "minimum_vram_mb" INTEGER,
  ADD COLUMN "minimum_scratch_bytes" BIGINT,
  ADD COLUMN "expected_runtime_seconds" INTEGER,
  ADD CONSTRAINT "pipeline_tasks_minimum_vram_mb_check"
    CHECK ("minimum_vram_mb" IS NULL OR "minimum_vram_mb" >= 0),
  ADD CONSTRAINT "pipeline_tasks_minimum_scratch_bytes_check"
    CHECK ("minimum_scratch_bytes" IS NULL OR "minimum_scratch_bytes" >= 0),
  ADD CONSTRAINT "pipeline_tasks_expected_runtime_seconds_check"
    CHECK ("expected_runtime_seconds" IS NULL OR "expected_runtime_seconds" > 0);

ALTER TABLE "approved_worker_images"
  ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "worker_sessions"
  ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "task_attempts"
  ADD COLUMN "download_ms" BIGINT,
  ADD COLUMN "model_load_ms" BIGINT,
  ADD COLUMN "upload_ms" BIGINT,
  ADD COLUMN "peak_vram_mb" INTEGER,
  ADD CONSTRAINT "task_attempts_metric_non_negative_check" CHECK (
    ("download_ms" IS NULL OR "download_ms" >= 0) AND
    ("model_load_ms" IS NULL OR "model_load_ms" >= 0) AND
    ("execution_ms" IS NULL OR "execution_ms" >= 0) AND
    ("upload_ms" IS NULL OR "upload_ms" >= 0) AND
    ("gpu_active_ms" IS NULL OR "gpu_active_ms" >= 0) AND
    ("peak_vram_mb" IS NULL OR "peak_vram_mb" >= 0) AND
    ("input_bytes" IS NULL OR "input_bytes" >= 0) AND
    ("output_bytes" IS NULL OR "output_bytes" >= 0)
  );

CREATE INDEX "pipeline_tasks_worker_claim_idx"
  ON "pipeline_tasks"("resource_class", "status", "priority" DESC, "ready_at", "id")
  WHERE "status" = 'READY';
