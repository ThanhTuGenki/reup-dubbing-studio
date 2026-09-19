import type { Prisma, PrismaClient, SystemCredentialKind } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import type { EncryptedCredential, SettingsRepository, StoredCredential } from '../application/ports';
import type { SettingsPatch, SettingsView } from '../domain/settings';
import { SettingsError } from '../domain/settings-errors';

const SINGLETON = 'DEFAULT';
const IDEMPOTENCY_SCOPE = 'PATCH_SETTINGS';

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<SettingsView> {
    const row = await this.prisma.systemSetting.findUniqueOrThrow({
      where: { singletonKey: SINGLETON },
      include: { contentAgentCredential: true, storageCredential: true },
    });
    return toView(row);
  }

  async update(input: {
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
    patch: SettingsPatch;
    contentAgentCredential?: EncryptedCredential | null;
    storageCredential?: EncryptedCredential | null;
  }): Promise<SettingsView> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const previous = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key: input.idempotencyKey } },
        });
        if (previous) {
          if (previous.requestHash !== input.requestHash) {
            throw new SettingsError('SETTINGS_VALIDATION_FAILED', 'Idempotency key was already used for a different request');
          }
          return previous.responseBody as unknown as SettingsView;
        }

        const current = await tx.systemSetting.findUniqueOrThrow({ where: { singletonKey: SINGLETON } });
        if (current.version !== input.expectedVersion) {
          throw new SettingsError('VERSION_CONFLICT', 'Settings were updated by another request');
        }

        const contentCredentialId = await applyCredential(
          tx, 'CONTENT_AGENT_API_KEY', input.contentAgentCredential,
        );
        const storageCredentialId = await applyCredential(
          tx, 'OBJECT_STORAGE_KEYPAIR', input.storageCredential,
        );
        const patch = input.patch;
        const data: Prisma.SystemSettingUncheckedUpdateInput = {
          version: { increment: 1 },
          ...(patch.contentAgent?.provider !== undefined ? { contentAgentProvider: patch.contentAgent.provider } : {}),
          ...(patch.contentAgent?.model !== undefined ? { contentAgentModel: patch.contentAgent.model } : {}),
          ...(contentCredentialId !== undefined ? { contentAgentCredentialId: contentCredentialId } : {}),
          ...(patch.storage?.backend !== undefined ? { storageBackend: patch.storage.backend } : {}),
          ...(patch.storage?.accountId !== undefined ? { storageAccountId: patch.storage.accountId } : {}),
          ...(patch.storage?.bucket !== undefined ? { storageBucket: patch.storage.bucket } : {}),
          ...(storageCredentialId !== undefined ? { storageCredentialId } : {}),
          ...(patch.retention?.rawVideoDays !== undefined ? { rawVideoDays: patch.retention.rawVideoDays } : {}),
          ...(patch.retention?.intermediateDays !== undefined ? { intermediateDays: patch.retention.intermediateDays } : {}),
          ...(patch.retention?.taskLogDays !== undefined ? { taskLogDays: patch.retention.taskLogDays } : {}),
          ...(patch.retention?.finalOutputDays !== undefined ? { finalOutputDays: patch.retention.finalOutputDays } : {}),
        };
        const write = await tx.systemSetting.updateMany({
          where: { id: current.id, version: input.expectedVersion },
          data,
        });
        if (write.count !== 1) {
          throw new SettingsError('VERSION_CONFLICT', 'Settings were updated by another request');
        }
        if (input.contentAgentCredential === null && current.contentAgentCredentialId) {
          await tx.systemCredential.delete({ where: { id: current.contentAgentCredentialId } });
        }
        if (input.storageCredential === null && current.storageCredentialId) {
          await tx.systemCredential.delete({ where: { id: current.storageCredentialId } });
        }
        const updated = await tx.systemSetting.findUniqueOrThrow({
          where: { id: current.id },
          include: { contentAgentCredential: true, storageCredential: true },
        });
        const view = toView(updated);
        await tx.idempotencyRecord.create({
          data: {
            id: uuidV7(),
            scope: IDEMPOTENCY_SCOPE,
            key: input.idempotencyKey,
            requestHash: input.requestHash,
            responseBody: view as unknown as Prisma.InputJsonValue,
            responseEtag: `"${view.version}"`,
          },
        });
        return view;
      });
    } catch (error) {
      // A concurrent retry may lose the version race after both requests initially
      // observed no record. Once the winner commits, replay its persisted result.
      if (error instanceof SettingsError && error.code === 'VERSION_CONFLICT') {
        const winner = await this.prisma.idempotencyRecord.findUnique({
          where: { scope_key: { scope: IDEMPOTENCY_SCOPE, key: input.idempotencyKey } },
        });
        if (winner?.requestHash === input.requestHash) {
          return winner.responseBody as unknown as SettingsView;
        }
      }
      throw error;
    }
  }

  getContentAgentCredential(): Promise<StoredCredential | null> {
    return this.getCredential('CONTENT_AGENT_API_KEY');
  }

  getStorageCredential(): Promise<StoredCredential | null> {
    return this.getCredential('OBJECT_STORAGE_KEYPAIR');
  }

  private async getCredential(kind: SystemCredentialKind): Promise<StoredCredential | null> {
    const credential = await this.prisma.systemCredential.findUnique({ where: { kind } });
    return credential ? { payload: credential.encryptedPayload, keyVersion: credential.keyVersion } : null;
  }
}

type Transaction = Prisma.TransactionClient;

async function applyCredential(
  tx: Transaction,
  kind: SystemCredentialKind,
  credential: EncryptedCredential | null | undefined,
): Promise<string | null | undefined> {
  if (credential === undefined) return undefined;
  if (credential === null) return null;
  const now = new Date();
  const saved = await tx.systemCredential.upsert({
    where: { kind },
    create: {
      id: uuidV7(), kind, encryptedPayload: Buffer.from(credential.payload),
      keyVersion: credential.keyVersion, hint: credential.hint, rotatedAt: now,
    },
    update: {
      encryptedPayload: Buffer.from(credential.payload), keyVersion: credential.keyVersion,
      hint: credential.hint, rotatedAt: now,
    },
  });
  return saved.id;
}

type SettingsRow = Awaited<ReturnType<PrismaClient['systemSetting']['findUniqueOrThrow']>> & {
  contentAgentCredential?: { hint: string | null; rotatedAt: Date } | null;
  storageCredential?: { hint: string | null; rotatedAt: Date } | null;
};

function toView(row: SettingsRow): SettingsView {
  return {
    version: row.version,
    contentAgent: {
      provider: row.contentAgentProvider,
      model: row.contentAgentModel,
      credential: credentialView(row.contentAgentCredential),
    },
    storage: {
      backend: row.storageBackend,
      accountId: row.storageAccountId,
      bucket: row.storageBucket,
      credential: credentialView(row.storageCredential),
    },
    retention: {
      rawVideoDays: row.rawVideoDays,
      intermediateDays: row.intermediateDays,
      taskLogDays: row.taskLogDays,
      finalOutputDays: row.finalOutputDays,
    },
  };
}

function credentialView(value: { hint: string | null; rotatedAt: Date } | null | undefined) {
  return value
    ? { configured: true, hint: value.hint, rotatedAt: value.rotatedAt.toISOString() }
    : { configured: false, hint: null, rotatedAt: null };
}
