CREATE TYPE "PublishPackageStatus" AS ENUM ('DRAFT', 'GENERATED', 'APPROVED', 'SUPERSEDED');
CREATE TYPE "PublicationTaskStatus" AS ENUM ('READY_FOR_CONTENT', 'CONTENT_GENERATED', 'CONTENT_APPROVED', 'READY_TO_PUBLISH', 'POSTING_MANUAL', 'PUBLISHED', 'VERIFIED', 'NEEDS_REVISION', 'CANCELLED');
CREATE TYPE "PublicationFieldOrigin" AS ENUM ('GENERATED', 'USER_EDITED', 'REGENERATED');
CREATE TYPE "PublicationChecklistStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');
CREATE TYPE "PublicationVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

CREATE TABLE "publish_packages" (
  "id" UUID NOT NULL,
  "video_id" UUID NOT NULL,
  "channel_profile_id" UUID NOT NULL,
  "status" "PublishPackageStatus" NOT NULL DEFAULT 'DRAFT',
  "context_snapshot" JSONB NOT NULL,
  "rules_version" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "publish_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publication_tasks" (
  "id" UUID NOT NULL,
  "publish_package_id" UUID NOT NULL,
  "destination_id" UUID NOT NULL,
  "render_output_id" UUID NOT NULL,
  "destination_snapshot" JSONB NOT NULL,
  "status" "PublicationTaskStatus" NOT NULL DEFAULT 'READY_FOR_CONTENT',
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "scheduled_at" TIMESTAMPTZ(6),
  "deadline_at" TIMESTAMPTZ(6),
  "assigned_to" UUID,
  "notes" TEXT,
  "published_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "publication_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publication_fields" (
  "id" UUID NOT NULL,
  "publication_task_id" UUID NOT NULL,
  "field_key" TEXT NOT NULL,
  "is_locked" BOOLEAN NOT NULL DEFAULT false,
  "current_revision_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "publication_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publication_field_revisions" (
  "id" UUID NOT NULL,
  "publication_field_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "value_text" TEXT NOT NULL,
  "origin" "PublicationFieldOrigin" NOT NULL,
  "generation_run_id" UUID,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "publication_field_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publication_checklist_items" (
  "id" UUID NOT NULL,
  "publication_task_id" UUID NOT NULL,
  "item_key" TEXT NOT NULL,
  "label_snapshot" TEXT NOT NULL,
  "is_required" BOOLEAN NOT NULL,
  "status" "PublicationChecklistStatus" NOT NULL DEFAULT 'PENDING',
  "completed_by" UUID,
  "completed_at" TIMESTAMPTZ(6),
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "publication_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "publication_proofs" (
  "id" UUID NOT NULL,
  "publication_task_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "platform_post_id" TEXT,
  "public_url" TEXT,
  "content_snapshot" JSONB NOT NULL,
  "submitted_by" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verification_status" "PublicationVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "verified_at" TIMESTAMPTZ(6),
  "verification_detail_safe" TEXT,
  CONSTRAINT "publication_proofs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "publication_proofs_identity_check" CHECK ("public_url" IS NOT NULL OR "platform_post_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "publish_packages_video_id_revision_key" ON "publish_packages"("video_id", "revision");
CREATE UNIQUE INDEX "publish_packages_one_active_per_video" ON "publish_packages"("video_id") WHERE "status" <> 'SUPERSEDED';
CREATE INDEX "publish_packages_video_id_status_idx" ON "publish_packages"("video_id", "status");
CREATE UNIQUE INDEX "publication_tasks_publish_package_id_destination_id_render_output_id_key" ON "publication_tasks"("publish_package_id", "destination_id", "render_output_id");
CREATE INDEX "publication_tasks_status_scheduled_at_id_idx" ON "publication_tasks"("status", "scheduled_at", "id");
CREATE INDEX "publication_tasks_destination_id_status_idx" ON "publication_tasks"("destination_id", "status");
CREATE UNIQUE INDEX "publication_fields_current_revision_id_key" ON "publication_fields"("current_revision_id");
CREATE UNIQUE INDEX "publication_fields_publication_task_id_field_key_key" ON "publication_fields"("publication_task_id", "field_key");
CREATE UNIQUE INDEX "publication_field_revisions_publication_field_id_revision_key" ON "publication_field_revisions"("publication_field_id", "revision");
CREATE UNIQUE INDEX "publication_checklist_items_publication_task_id_item_key_key" ON "publication_checklist_items"("publication_task_id", "item_key");
CREATE UNIQUE INDEX "publication_proofs_publication_task_id_attempt_number_key" ON "publication_proofs"("publication_task_id", "attempt_number");

ALTER TABLE "publish_packages" ADD CONSTRAINT "publish_packages_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publish_packages" ADD CONSTRAINT "publish_packages_channel_profile_id_fkey" FOREIGN KEY ("channel_profile_id") REFERENCES "channel_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publish_packages" ADD CONSTRAINT "publish_packages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_tasks" ADD CONSTRAINT "publication_tasks_publish_package_id_fkey" FOREIGN KEY ("publish_package_id") REFERENCES "publish_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_tasks" ADD CONSTRAINT "publication_tasks_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "publishing_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_tasks" ADD CONSTRAINT "publication_tasks_render_output_id_fkey" FOREIGN KEY ("render_output_id") REFERENCES "render_outputs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_tasks" ADD CONSTRAINT "publication_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_fields" ADD CONSTRAINT "publication_fields_publication_task_id_fkey" FOREIGN KEY ("publication_task_id") REFERENCES "publication_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_field_revisions" ADD CONSTRAINT "publication_field_revisions_publication_field_id_fkey" FOREIGN KEY ("publication_field_id") REFERENCES "publication_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_field_revisions" ADD CONSTRAINT "publication_field_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_fields" ADD CONSTRAINT "publication_fields_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "publication_field_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_checklist_items" ADD CONSTRAINT "publication_checklist_items_publication_task_id_fkey" FOREIGN KEY ("publication_task_id") REFERENCES "publication_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_checklist_items" ADD CONSTRAINT "publication_checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_proofs" ADD CONSTRAINT "publication_proofs_publication_task_id_fkey" FOREIGN KEY ("publication_task_id") REFERENCES "publication_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "publication_proofs" ADD CONSTRAINT "publication_proofs_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
