CREATE TYPE "VideoSourceKind" AS ENUM ('DISCOVERED', 'LOCAL_UPLOAD');
CREATE TYPE "TaskDependencyKind" AS ENUM ('SUCCESS');

ALTER TABLE "videos"
  ALTER COLUMN "source_content_id" DROP NOT NULL,
  ADD COLUMN "source_kind" "VideoSourceKind" NOT NULL DEFAULT 'DISCOVERED',
  ADD COLUMN "local_source_metadata" JSONB,
  ADD CONSTRAINT "videos_source_shape_check" CHECK (
    ("source_kind" = 'DISCOVERED' AND "source_content_id" IS NOT NULL AND "local_source_metadata" IS NULL)
    OR
    ("source_kind" = 'LOCAL_UPLOAD' AND "source_content_id" IS NULL AND "local_source_metadata" IS NOT NULL)
  );

CREATE TABLE "pipeline_task_dependencies" (
  "task_id" UUID NOT NULL,
  "depends_on_task_id" UUID NOT NULL,
  "kind" "TaskDependencyKind" NOT NULL DEFAULT 'SUCCESS',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_task_dependencies_pkey" PRIMARY KEY ("task_id", "depends_on_task_id"),
  CONSTRAINT "pipeline_task_dependencies_no_self_check" CHECK ("task_id" <> "depends_on_task_id")
);

CREATE INDEX "pipeline_task_dependencies_depends_on_task_id_task_id_idx"
  ON "pipeline_task_dependencies"("depends_on_task_id", "task_id");

ALTER TABLE "pipeline_task_dependencies"
  ADD CONSTRAINT "pipeline_task_dependencies_task_id_fkey"
    FOREIGN KEY ("task_id") REFERENCES "pipeline_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pipeline_task_dependencies_depends_on_task_id_fkey"
    FOREIGN KEY ("depends_on_task_id") REFERENCES "pipeline_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
