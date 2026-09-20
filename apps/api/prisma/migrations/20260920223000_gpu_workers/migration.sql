CREATE TYPE "WorkerRole" AS ENUM ('BATCH_MEDIA', 'INTERACTIVE_TTS');
CREATE TYPE "WorkerMode" AS ENUM ('MANUAL_REGISTERED', 'API_PROVISIONED');
CREATE TYPE "WorkerDesiredStatus" AS ENUM ('ACTIVE', 'DRAINING', 'REVOKED');
CREATE TYPE "WorkerObservedStatus" AS ENUM ('PENDING', 'READY', 'BUSY', 'DRAINING', 'SAFE_TO_TERMINATE', 'OFFLINE', 'TERMINATED', 'ERROR');
CREATE TYPE "WorkerImageStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "WorkerSessionEndReason" AS ENUM ('DRAINED', 'TERMINATED', 'REPLACED', 'CREDENTIAL_REVOKED', 'HEARTBEAT_TIMEOUT', 'VERSION_MISMATCH', 'ERROR');

CREATE TABLE "approved_worker_images" (
  "id" UUID NOT NULL, "role" "WorkerRole" NOT NULL, "semantic_version" TEXT NOT NULL,
  "image_digest" TEXT NOT NULL, "registry_ref" TEXT NOT NULL, "contract_version" INTEGER NOT NULL,
  "status" "WorkerImageStatus" NOT NULL DEFAULT 'ACTIVE', "approved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "approved_worker_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "approved_worker_images_role_image_digest_key" ON "approved_worker_images"("role", "image_digest");

CREATE TABLE "workers" (
  "id" UUID NOT NULL, "display_name" TEXT NOT NULL, "role" "WorkerRole" NOT NULL,
  "provider" TEXT NOT NULL, "provider_instance_id" TEXT, "mode" "WorkerMode" NOT NULL DEFAULT 'MANUAL_REGISTERED',
  "desired_status" "WorkerDesiredStatus" NOT NULL DEFAULT 'ACTIVE', "observed_status" "WorkerObservedStatus" NOT NULL DEFAULT 'PENDING',
  "expected_gpu_model" TEXT, "expected_vram_mb" INTEGER, "approved_image_id" UUID NOT NULL,
  "last_error_code" TEXT, "last_error_detail_safe" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "workers_pkey" PRIMARY KEY ("id"), CONSTRAINT "workers_expected_vram_mb_check" CHECK ("expected_vram_mb" IS NULL OR "expected_vram_mb" >= 0)
);
CREATE INDEX "workers_observed_status_role_updated_at_id_idx" ON "workers"("observed_status", "role", "updated_at", "id");

CREATE TABLE "worker_enrollment_tokens" (
  "id" UUID NOT NULL, "worker_id" UUID NOT NULL, "token_prefix" TEXT NOT NULL, "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL, "consumed_at" TIMESTAMPTZ(6), "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "worker_enrollment_tokens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "worker_enrollment_tokens_token_prefix_idx" ON "worker_enrollment_tokens"("token_prefix");
CREATE UNIQUE INDEX "worker_enrollment_tokens_one_active" ON "worker_enrollment_tokens"("worker_id") WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;

CREATE TABLE "worker_credentials" (
  "id" UUID NOT NULL, "worker_id" UUID NOT NULL, "credential_prefix" TEXT NOT NULL, "credential_hash" TEXT NOT NULL,
  "scopes" TEXT[], "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expires_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6), "revoked_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "worker_credentials_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "worker_credentials_credential_prefix_idx" ON "worker_credentials"("credential_prefix");
CREATE UNIQUE INDEX "worker_credentials_one_active" ON "worker_credentials"("worker_id") WHERE "revoked_at" IS NULL;

CREATE TABLE "worker_billing_sessions" (
  "id" UUID NOT NULL, "worker_id" UUID NOT NULL, "provider" TEXT NOT NULL, "provider_instance_id" TEXT,
  "hourly_rate_cp" DECIMAL(20,6) NOT NULL, "paid_vnd_per_cp" DECIMAL(20,8), "billing_started_at" TIMESTAMPTZ(6) NOT NULL,
  "billing_ended_at" TIMESTAMPTZ(6), "termination_confirmed_at" TIMESTAMPTZ(6), "estimated_cost_cp" DECIMAL(24,6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "worker_billing_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worker_billing_sessions_rate_check" CHECK ("hourly_rate_cp" >= 0 AND ("paid_vnd_per_cp" IS NULL OR "paid_vnd_per_cp" >= 0)),
  CONSTRAINT "worker_billing_sessions_time_check" CHECK ("billing_ended_at" IS NULL OR "billing_ended_at" >= "billing_started_at")
);
CREATE UNIQUE INDEX "worker_billing_sessions_one_open" ON "worker_billing_sessions"("worker_id") WHERE "billing_ended_at" IS NULL;

CREATE TABLE "worker_sessions" (
  "id" UUID NOT NULL, "worker_id" UUID NOT NULL, "credential_id" UUID NOT NULL, "billing_session_id" UUID NOT NULL,
  "session_nonce" UUID NOT NULL, "image_id" UUID NOT NULL, "image_digest" TEXT NOT NULL, "agent_version" TEXT NOT NULL,
  "contract_version" INTEGER NOT NULL, "gpu_inventory" JSONB NOT NULL DEFAULT '[]', "cpu_inventory" JSONB NOT NULL DEFAULT '{}',
  "capacity" JSONB NOT NULL DEFAULT '{}', "telemetry_safe" JSONB NOT NULL DEFAULT '{}', "current_task_count" INTEGER NOT NULL DEFAULT 0,
  "last_heartbeat_sequence" BIGINT NOT NULL DEFAULT 0, "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_heartbeat_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "draining_at" TIMESTAMPTZ(6), "ended_at" TIMESTAMPTZ(6),
  "end_reason" "WorkerSessionEndReason",
  CONSTRAINT "worker_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worker_sessions_count_check" CHECK ("current_task_count" >= 0 AND "last_heartbeat_sequence" >= 0)
);
CREATE UNIQUE INDEX "worker_sessions_worker_id_session_nonce_key" ON "worker_sessions"("worker_id", "session_nonce");
CREATE UNIQUE INDEX "worker_sessions_one_active" ON "worker_sessions"("worker_id") WHERE "ended_at" IS NULL;
CREATE INDEX "worker_sessions_last_heartbeat_at_idx" ON "worker_sessions"("last_heartbeat_at");

ALTER TABLE "workers" ADD CONSTRAINT "workers_approved_image_id_fkey" FOREIGN KEY ("approved_image_id") REFERENCES "approved_worker_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_enrollment_tokens" ADD CONSTRAINT "worker_enrollment_tokens_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_credentials" ADD CONSTRAINT "worker_credentials_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_billing_sessions" ADD CONSTRAINT "worker_billing_sessions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_sessions" ADD CONSTRAINT "worker_sessions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_sessions" ADD CONSTRAINT "worker_sessions_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "worker_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_sessions" ADD CONSTRAINT "worker_sessions_billing_session_id_fkey" FOREIGN KEY ("billing_session_id") REFERENCES "worker_billing_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_sessions" ADD CONSTRAINT "worker_sessions_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "approved_worker_images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_worker_session_id_fkey" FOREIGN KEY ("worker_session_id") REFERENCES "worker_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_leases" ADD CONSTRAINT "task_leases_worker_session_id_fkey" FOREIGN KEY ("worker_session_id") REFERENCES "worker_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
