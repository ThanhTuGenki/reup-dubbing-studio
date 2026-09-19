CREATE TYPE "ContentAgentProvider" AS ENUM ('ANTHROPIC', 'OPENAI');
CREATE TYPE "StorageBackend" AS ENUM ('R2');
CREATE TYPE "SystemCredentialKind" AS ENUM ('CONTENT_AGENT_API_KEY', 'OBJECT_STORAGE_KEYPAIR');

CREATE TABLE "system_credentials" (
    "id" UUID NOT NULL,
    "kind" "SystemCredentialKind" NOT NULL,
    "encrypted_payload" BYTEA NOT NULL,
    "key_version" INTEGER NOT NULL,
    "hint" TEXT,
    "rotated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "system_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "singleton_key" TEXT NOT NULL DEFAULT 'DEFAULT',
    "content_agent_provider" "ContentAgentProvider" NOT NULL,
    "content_agent_model" TEXT NOT NULL,
    "content_agent_credential_id" UUID,
    "storage_backend" "StorageBackend" NOT NULL DEFAULT 'R2',
    "storage_account_id" TEXT NOT NULL,
    "storage_bucket" TEXT NOT NULL,
    "storage_credential_id" UUID,
    "raw_video_days" INTEGER NOT NULL DEFAULT 7,
    "intermediate_days" INTEGER NOT NULL DEFAULT 3,
    "task_log_days" INTEGER NOT NULL DEFAULT 30,
    "final_output_days" INTEGER NOT NULL DEFAULT 90,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "system_settings_singleton_key_check" CHECK ("singleton_key" = 'DEFAULT'),
    CONSTRAINT "system_settings_raw_video_days_check" CHECK ("raw_video_days" BETWEEN 1 AND 365),
    CONSTRAINT "system_settings_intermediate_days_check" CHECK ("intermediate_days" BETWEEN 1 AND 90),
    CONSTRAINT "system_settings_task_log_days_check" CHECK ("task_log_days" BETWEEN 1 AND 365),
    CONSTRAINT "system_settings_final_output_days_check" CHECK ("final_output_days" BETWEEN 1 AND 3650)
);

CREATE UNIQUE INDEX "system_credentials_kind_key" ON "system_credentials"("kind");
CREATE UNIQUE INDEX "system_settings_singleton_key_key" ON "system_settings"("singleton_key");

ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_content_agent_credential_id_fkey"
FOREIGN KEY ("content_agent_credential_id") REFERENCES "system_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_storage_credential_id_fkey"
FOREIGN KEY ("storage_credential_id") REFERENCES "system_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_body" JSONB NOT NULL,
    "response_etag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

INSERT INTO "system_settings" (
    "id", "singleton_key", "content_agent_provider", "content_agent_model",
    "storage_backend", "storage_account_id", "storage_bucket", "updated_at"
) VALUES (
    '01994429-ec00-7000-8000-000000000001', 'DEFAULT', 'ANTHROPIC', '',
    'R2', '', '', CURRENT_TIMESTAMP
);
