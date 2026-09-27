import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient, PublicationChecklistStatus } from '@prisma/client';
import type { PublicationTask, PublicationTaskSummary, PublishPackage } from '@reup-dubbing-studio/api-contract';
import { uuidV7 } from '../../../platform/ids/uuid-v7';
import { resolveReviewPolicySnapshot } from '../../review-policy/infrastructure/prisma-review-policy-repository';
import { PublishingError } from '../domain/publishing-errors';
import type { CreatePackageInput, ProofInput, ProofVerificationInput, PublicationAssetRole, PublicationFilters, PublicationPlanInput } from '../domain/publishing';

/* Repository mapping is deliberately centralized: OpenAPI stays the wire source of truth. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const RULES_VERSION = 'manual-publishing-rules-v1';
const fieldsByPlatform = {
  YOUTUBE: ['title', 'description', 'keywords', 'hashtags', 'thumbnailText', 'thumbnailPrompt'],
  FACEBOOK: ['caption', 'hashtags', 'thumbnailText', 'thumbnailPrompt'],
} as const;
const checklistCatalogue = [
  ['uploadVideo', 'Tải video lên', true], ['uploadSubtitle', 'Tải phụ đề lên', true],
  ['attachThumbnail', 'Gắn thumbnail', false], ['copyMetadata', 'Sao chép metadata', true],
  ['configurePlatform', 'Cấu hình nền tảng', true], ['setVisibilityOrSchedule', 'Đặt quyền xem hoặc lịch', true],
  ['previewBeforePublish', 'Xem lại trước khi đăng', true],
] as const;
const taskInclude = {
  publishPackage: true,
  fields: { include: { currentRevision: true, revisions: { orderBy: { revision: 'desc' as const } } }, orderBy: { fieldKey: 'asc' as const } },
  checklist: { orderBy: { ordinal: 'asc' as const } },
  proofs: { orderBy: { attemptNumber: 'desc' as const } },
  renderOutput: { include: { videoAsset: { include: { asset: true } }, subtitleAsset: { include: { asset: true } }, thumbnailAsset: { include: { asset: true } } } },
} satisfies Prisma.PublicationTaskInclude;
type Tx = Prisma.TransactionClient;

export class PrismaPublishingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(filters: PublicationFilters) {
    const limit = Math.min(filters.limit ?? 50, 100); const cursor = decodeCursor(filters.cursor); const now = new Date();
    const rows = await this.prisma.publicationTask.findMany({
      where: {
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.destinationId ? { destinationId: filters.destinationId } : {}),
        ...(filters.videoId ? { publishPackage: { videoId: filters.videoId } } : {}),
        ...(filters.platform ? { destinationSnapshot: { path: ['platform'], equals: filters.platform } } : {}),
        ...(filters.scheduled === true ? { scheduledAt: { not: null } } : filters.scheduled === false ? { scheduledAt: null } : {}),
        ...(filters.overdue ? { deadlineAt: { lt: now }, status: { notIn: ['PUBLISHED', 'VERIFIED', 'CANCELLED'] } } : {}),
        ...(cursor ? { OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }] } : {}),
      }, include: { publishPackage: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    });
    const page = rows.slice(0, limit); const last = page.at(-1);
    return { items: page.map(summary), nextCursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null };
  }

  async package(id: string): Promise<PublishPackage> {
    const row = await this.prisma.publishPackage.findUnique({ where: { id }, include: { tasks: { include: { publishPackage: true }, orderBy: { createdAt: 'asc' } } } });
    if (!row) fail('PUBLISH_PACKAGE_NOT_FOUND', 'Publish package was not found');
    return packageView(row);
  }

  async task(id: string): Promise<PublicationTask> { return this.detail(this.prisma, id); }

  async createPackage(videoId: string, input: CreatePackageInput, key: string): Promise<PublishPackage> {
    if (!input.tasks.length) fail('PUBLICATION_INVALID_TRANSITION', 'At least one publication task is required');
    return this.idempotent('CREATE_PUBLISH_PACKAGE_V1', key, { videoId, input }, async (tx) => {
      const video = await tx.video.findUnique({ where: { id: videoId }, include: { sourceContent: true } });
      if (!video) fail('PUBLISH_PACKAGE_NOT_FOUND', 'Video was not found');
      const existing = await tx.publishPackage.findFirst({ where: { videoId, status: { not: 'SUPERSEDED' } } });
      if (existing) fail('PUBLICATION_INVALID_TRANSITION', 'Video already has an active publish package');
      const pairs = new Set(input.tasks.map((item) => `${item.destinationId}:${item.renderOutputId}`));
      if (pairs.size !== input.tasks.length) fail('PUBLICATION_INVALID_TRANSITION', 'Duplicate publication task');
      const destinations = await tx.publishingDestination.findMany({ where: { id: { in: input.tasks.map((x) => x.destinationId) } } });
      const outputs = await tx.renderOutput.findMany({ where: { id: { in: input.tasks.map((x) => x.renderOutputId) } }, include: { videoAsset: { include: { asset: true } }, subtitleAsset: { include: { asset: true } }, thumbnailAsset: { include: { asset: true } } } });
      const policy = await resolveReviewPolicySnapshot(tx, { channelProfileId: video.channelProfileId, seriesProfileId: video.seriesProfileId });
      for (const item of input.tasks) {
        const destination = destinations.find((x) => x.id === item.destinationId);
        const output = outputs.find((x) => x.id === item.renderOutputId);
        if (!destination?.isActive || destination.channelProfileId !== video.channelProfileId) fail('PUBLICATION_DESTINATION_INACTIVE', 'Destination is inactive or belongs to another Channel');
        if (!output || output.videoId !== videoId || output.status !== 'APPROVED') fail('PUBLICATION_ASSET_UNAVAILABLE', 'Render output is not approved for this Video');
        if (output.videoAsset?.asset.status !== 'AVAILABLE') fail('PUBLICATION_ASSET_UNAVAILABLE', 'Approved video asset is unavailable');
      }
      const revision = (await tx.publishPackage.aggregate({ where: { videoId }, _max: { revision: true } }))._max.revision ?? 0;
      const id = uuidV7();
      const row = await tx.publishPackage.create({ data: {
        id, videoId, channelProfileId: video.channelProfileId, revision: revision + 1, rulesVersion: RULES_VERSION, createdBy: OWNER_ID,
        contextSnapshot: { schemaVersion: 1, source: { externalId: video.sourceContent?.externalId ?? video.id, title: video.displayTitle }, reviewPolicy: policy, rulesVersion: RULES_VERSION },
        tasks: { create: input.tasks.map((item) => {
          const destination = destinations.find((x) => x.id === item.destinationId)!; return {
            id: uuidV7(), destinationId: item.destinationId, renderOutputId: item.renderOutputId, assignedTo: OWNER_ID, isRequired: destination.isRequired,
            destinationSnapshot: { platform: destination.platform, externalId: destination.externalId, displayName: destination.displayName },
            fields: { create: fieldsByPlatform[destination.platform].map((fieldKey) => ({ id: uuidV7(), fieldKey })) },
            checklist: { create: checklistCatalogue.map(([itemKey, labelSnapshot, isRequired], ordinal) => ({ id: uuidV7(), itemKey, labelSnapshot, isRequired, ordinal })) },
          }; 
        }) },
      }, include: { tasks: { include: { publishPackage: true }, orderBy: { createdAt: 'asc' } } } });
      return packageView(row);
    });
  }

  async updateField(taskId: string, fieldKey: string, value: string, version: number) {
    return this.prisma.$transaction(async (tx) => {
      const task = await mutableTask(tx, taskId, version);
      const field = await tx.publicationField.findUnique({ where: { publicationTaskId_fieldKey: { publicationTaskId: taskId, fieldKey } }, include: { revisions: true } });
      if (!field) fail('PUBLICATION_CONTENT_INCOMPLETE', 'Field is not part of the destination catalogue');
      if (field.isLocked) fail('PUBLICATION_FIELD_LOCKED', 'Publication field is locked');
      if (!value.trim()) fail('PUBLICATION_CONTENT_INCOMPLETE', 'Publication field cannot be empty');
      const revisionId = uuidV7();
      await tx.publicationFieldRevision.create({ data: { id: revisionId, publicationFieldId: field.id, revision: field.revisions.length + 1, valueText: value.trim(), origin: 'USER_EDITED', createdBy: OWNER_ID } });
      await tx.publicationField.update({ where: { id: field.id }, data: { currentRevisionId: revisionId, version: { increment: 1 } } });
      const remaining = await tx.publicationField.count({ where: { publicationTaskId: taskId, currentRevisionId: null, id: { not: field.id } } });
      await tx.publicationTask.update({ where: { id: taskId }, data: { version: { increment: 1 }, status: remaining === 0 ? 'CONTENT_GENERATED' : 'READY_FOR_CONTENT' } });
      await projectPackage(tx, task.publishPackageId);
      return this.detail(tx, taskId);
    }, { isolationLevel: 'Serializable' });
  }

  async lockField(taskId: string, fieldKey: string, isLocked: boolean, version: number) {
    return this.prisma.$transaction(async (tx) => { await mutableTask(tx, taskId, version); const changed = await tx.publicationField.updateMany({ where: { publicationTaskId: taskId, fieldKey }, data: { isLocked, version: { increment: 1 } } }); if (!changed.count) fail('PUBLICATION_CONTENT_INCOMPLETE', 'Field was not found'); await bump(tx, taskId); return this.detail(tx, taskId); });
  }

  approve(taskId: string, version: number, key: string) {
    return this.taskMutation('APPROVE_PUBLICATION_CONTENT_V1', key, { taskId, version }, async (tx) => {
      const task = await mutableTask(tx, taskId, version); if (task.status !== 'CONTENT_GENERATED' && task.status !== 'NEEDS_REVISION') fail('PUBLICATION_INVALID_TRANSITION', 'Task content is not ready for approval');
      if (await tx.publicationField.count({ where: { publicationTaskId: taskId, currentRevisionId: null } })) fail('PUBLICATION_CONTENT_INCOMPLETE', 'Required publication content is incomplete');
      const packageRow = await tx.publishPackage.findUniqueOrThrow({ where: { id: task.publishPackageId }, include: { video: true } });
      const policy = await resolveReviewPolicySnapshot(tx, { channelProfileId: packageRow.video.channelProfileId, seriesProfileId: packageRow.video.seriesProfileId });
      const subject = await subjectVersion(tx, taskId, packageRow.revision);
      if (policy.effective.publishContentGate === 'MANUAL_REQUIRED') await tx.reviewDecision.create({ data: { id: uuidV7(), videoId: packageRow.videoId, scope: 'PUBLISH_CONTENT', subjectVersion: subject, decision: 'APPROVED', decidedBy: OWNER_ID } });
      await tx.publicationTask.update({ where: { id: taskId }, data: { status: 'READY_TO_PUBLISH', version: { increment: 1 } } }); await projectPackage(tx, task.publishPackageId); return this.detail(tx, taskId);
    }); 
  }

  async plan(taskId: string, version: number, input: PublicationPlanInput) {
    return this.prisma.$transaction(async (tx) => { await mutableTask(tx, taskId, version); if (input.scheduledAt && input.deadlineAt && new Date(input.deadlineAt) < new Date(input.scheduledAt)) fail('PUBLICATION_INVALID_TRANSITION', 'Deadline must not be before scheduled time'); await tx.publicationTask.update({ where: { id: taskId }, data: { ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null } : {}), ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt ? new Date(input.deadlineAt) : null } : {}), ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}), version: { increment: 1 } } }); return this.detail(tx, taskId); });
  }

  async checklist(taskId: string, itemKey: string, status: PublicationChecklistStatus, version: number) {
    return this.prisma.$transaction(async (tx) => { await mutableTask(tx, taskId, version); const item = await tx.publicationChecklistItem.findUnique({ where: { publicationTaskId_itemKey: { publicationTaskId: taskId, itemKey } } }); if (!item) fail('PUBLICATION_CHECKLIST_INCOMPLETE', 'Checklist item was not found'); if (item.isRequired && status === 'SKIPPED') fail('PUBLICATION_CHECKLIST_INCOMPLETE', 'Required checklist item cannot be skipped'); await tx.publicationChecklistItem.update({ where: { id: item.id }, data: { status, completedBy: status === 'COMPLETED' ? OWNER_ID : null, completedAt: status === 'COMPLETED' ? new Date() : null } }); await bump(tx, taskId); return this.detail(tx, taskId); });
  }

  start(taskId: string, version: number, key: string) { return this.taskMutation('START_MANUAL_POSTING_V1', key, { taskId, version }, async (tx) => { const task = await mutableTask(tx, taskId, version); if (task.status !== 'READY_TO_PUBLISH') fail('PUBLICATION_CONTENT_APPROVAL_REQUIRED', 'Content must be approved before posting'); await ensureAssets(tx, taskId); await tx.publicationTask.update({ where: { id: taskId }, data: { status: 'POSTING_MANUAL', version: { increment: 1 } } }); return this.detail(tx, taskId); }); }

  proof(taskId: string, version: number, input: ProofInput, key: string) {
    return this.taskMutation('CREATE_PUBLICATION_PROOF_V1', key, { taskId, version, input }, async (tx) => {
      const task = await mutableTask(tx, taskId, version, true); if (!['POSTING_MANUAL', 'PUBLISHED'].includes(task.status)) fail('PUBLICATION_INVALID_TRANSITION', 'Task is not in manual posting');
      const url = input.publicUrl?.trim() || null; const postId = input.platformPostId?.trim() || null; if (!url && !postId) fail('PUBLICATION_PROOF_REQUIRED', 'A public URL or platform post ID is required');
      if (url) { let parsed: URL; try { parsed = new URL(url); } catch { fail('PUBLICATION_PROOF_REQUIRED', 'Public URL is invalid'); } if (parsed!.protocol !== 'https:' || parsed!.username || parsed!.password) fail('PUBLICATION_PROOF_REQUIRED', 'Public URL must be a credential-free HTTPS URL'); }
      if (postId && /[?&#=]/u.test(postId)) fail('PUBLICATION_PROOF_REQUIRED', 'Platform post ID contains unsafe characters');
      if (await tx.publicationChecklistItem.count({ where: { publicationTaskId: taskId, isRequired: true, status: { not: 'COMPLETED' } } })) fail('PUBLICATION_CHECKLIST_INCOMPLETE', 'Required checklist is incomplete'); await ensureAssets(tx, taskId);
      const fields = await tx.publicationField.findMany({ where: { publicationTaskId: taskId }, include: { currentRevision: true }, orderBy: { fieldKey: 'asc' } });
      const attempt = await tx.publicationProof.count({ where: { publicationTaskId: taskId } }) + 1; await tx.publicationProof.create({ data: { id: uuidV7(), publicationTaskId: taskId, attemptNumber: attempt, publicUrl: url, platformPostId: postId, submittedBy: OWNER_ID, contentSnapshot: { fields: fields.map((x) => ({ key: x.fieldKey, revisionId: x.currentRevisionId, value: x.currentRevision?.valueText })) } } });
      await tx.publicationTask.update({ where: { id: taskId }, data: { status: 'PUBLISHED', publishedAt: new Date(), version: { increment: 1 } } }); return this.detail(tx, taskId);
    }); 
  }

  verify(taskId: string, proofId: string, version: number, input: ProofVerificationInput, key: string) {
    return this.taskMutation('VERIFY_PUBLICATION_PROOF_V1', key, { taskId, proofId, version, input }, async (tx) => {
      const task = await mutableTask(tx, taskId, version, true); const latest = await tx.publicationProof.findFirst({ where: { publicationTaskId: taskId }, orderBy: { attemptNumber: 'desc' } }); if (!latest || latest.id !== proofId || latest.verificationStatus !== 'PENDING') fail('PUBLICATION_PROOF_REQUIRED', 'Only the latest pending proof can be verified');
      await tx.publicationProof.update({ where: { id: proofId }, data: { verificationStatus: input.status, verifiedAt: new Date(), verificationDetailSafe: input.detail?.trim() || null } }); const status = input.status === 'VERIFIED' ? 'VERIFIED' : 'NEEDS_REVISION'; await tx.publicationTask.update({ where: { id: taskId }, data: { status, version: { increment: 1 } } });
      if (input.status === 'VERIFIED') { const siblings = await tx.publicationTask.findMany({ where: { publishPackageId: task.publishPackageId, isRequired: true }, select: { id: true, status: true } }); if (siblings.every((x) => x.id === taskId || x.status === 'VERIFIED')) { const pkg = await tx.publishPackage.findUniqueOrThrow({ where: { id: task.publishPackageId } }); await tx.video.update({ where: { id: pkg.videoId }, data: { status: 'PUBLISHED', version: { increment: 1 } } }); } }
      return this.detail(tx, taskId);
    }); 
  }

  requestRevision(taskId: string, version: number, key: string) { return this.taskMutation('REQUEST_PUBLICATION_REVISION_V1', key, { taskId, version }, async (tx) => { const task = await mutableTask(tx, taskId, version, true); if (!['CONTENT_GENERATED', 'CONTENT_APPROVED', 'READY_TO_PUBLISH', 'POSTING_MANUAL', 'PUBLISHED', 'VERIFIED'].includes(task.status)) fail('PUBLICATION_INVALID_TRANSITION', 'Task cannot enter revision from its current status'); await tx.publicationTask.update({ where: { id: taskId }, data: { status: 'NEEDS_REVISION', version: { increment: 1 } } }); await projectPackage(tx, task.publishPackageId); return this.detail(tx, taskId); }); }

  async asset(taskId: string, role: PublicationAssetRole) { const task = await this.prisma.publicationTask.findUnique({ where: { id: taskId }, include: taskInclude }); if (!task) missing(); const link = role === 'VIDEO' ? task.renderOutput.videoAsset : role === 'SUBTITLE' ? task.renderOutput.subtitleAsset : task.renderOutput.thumbnailAsset; if (!link || link.asset.status !== 'AVAILABLE' || link.asset.deletedAt) fail('PUBLICATION_ASSET_UNAVAILABLE', 'Publication asset is unavailable'); return link.asset; }
  contentAgentUnavailable(): never { return fail('PUBLICATION_CONTENT_AGENT_UNAVAILABLE', 'Content generation integration is not configured; edit metadata fields manually'); }

  private async detail(client: Tx | PrismaClient, id: string): Promise<PublicationTask> { const row = await client.publicationTask.findUnique({ where: { id }, include: taskInclude }); if (!row) missing(); const siblings = await client.publicationTask.findMany({ where: { publishPackageId: row.publishPackageId, id: { not: row.id } }, include: { publishPackage: true }, orderBy: { createdAt: 'asc' } }); return taskView(row, siblings); }
  private taskMutation(scope: string, key: string, request: object, action: (tx: Tx) => Promise<PublicationTask>) { return this.idempotent(scope, key, request, action); }
  private async idempotent<T>(scope: string, key: string, request: object, action: (tx: Tx) => Promise<T>): Promise<T> { const keyHash = hash(key); const requestHash = hash(stable(request)); try { return await this.prisma.$transaction(async (tx) => { const old = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: keyHash } } }); if (old) return replay<T>(old.requestHash, requestHash, old.responseBody); const result = await action(tx); await tx.idempotencyRecord.create({ data: { id: uuidV7(), scope, key: keyHash, requestHash, responseBody: result as Prisma.InputJsonValue, responseEtag: `"${(result as any).version ?? 1}"` } }); return result; }, { isolationLevel: 'Serializable' }); } catch (error) { const old = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: keyHash } } }); if (old) return replay<T>(old.requestHash, requestHash, old.responseBody); throw error; } }
}

async function mutableTask(tx: Tx, id: string, version: number, allowPublished = false) { const task = await tx.publicationTask.findUnique({ where: { id } }); if (!task) missing(); if (task.version !== version) fail('PUBLICATION_VERSION_CONFLICT', 'Publication task version is stale'); if (!allowPublished && ['PUBLISHED', 'VERIFIED', 'CANCELLED'].includes(task.status)) fail('PUBLICATION_INVALID_TRANSITION', 'Publication task is frozen'); return task; }
async function bump(tx: Tx, id: string) { await tx.publicationTask.update({ where: { id }, data: { version: { increment: 1 } } }); }
async function ensureAssets(tx: Tx, id: string) { const task = await tx.publicationTask.findUniqueOrThrow({ where: { id }, include: { renderOutput: { include: { videoAsset: { include: { asset: true } }, subtitleAsset: { include: { asset: true } } } } } }); if (task.renderOutput.videoAsset?.asset.status !== 'AVAILABLE' || task.renderOutput.subtitleAsset?.asset.status !== 'AVAILABLE') fail('PUBLICATION_ASSET_UNAVAILABLE', 'Required output assets are unavailable'); }
async function projectPackage(tx: Tx, id: string) { const tasks = await tx.publicationTask.findMany({ where: { publishPackageId: id }, select: { status: true, isRequired: true } }); const active = tasks.filter((x) => x.status !== 'CANCELLED'); const required = active.filter((x) => x.isRequired); const approved = ['CONTENT_APPROVED', 'READY_TO_PUBLISH', 'POSTING_MANUAL', 'PUBLISHED', 'VERIFIED']; const status = required.length && required.every((x) => approved.includes(x.status)) ? 'APPROVED' : active.length && active.every((x) => x.status !== 'READY_FOR_CONTENT') ? 'GENERATED' : 'DRAFT'; await tx.publishPackage.update({ where: { id }, data: { status, version: { increment: 1 } } }); }
async function subjectVersion(tx: Tx, taskId: string, packageRevision: number) { const rows = await tx.publicationField.findMany({ where: { publicationTaskId: taskId }, select: { currentRevisionId: true }, orderBy: { fieldKey: 'asc' } }); return `publication-task:${taskId}:package:${packageRevision}:fields:${hash(rows.map((x) => x.currentRevisionId).join(':'))}`; }
function summary(row: any): PublicationTaskSummary { const snapshot = row.destinationSnapshot as { platform: 'YOUTUBE'|'FACEBOOK'; displayName: string }; return { id: row.id, packageId: row.publishPackageId, videoId: row.publishPackage.videoId, destinationId: row.destinationId, renderOutputId: row.renderOutputId, platform: snapshot.platform, destinationName: snapshot.displayName, status: row.status, isRequired: row.isRequired, scheduledAt: row.scheduledAt?.toISOString() ?? null, deadlineAt: row.deadlineAt?.toISOString() ?? null, version: row.version, updatedAt: row.updatedAt.toISOString() }; }
function packageView(row: any): PublishPackage { return { id: row.id, videoId: row.videoId, channelProfileId: row.channelProfileId, status: row.status, rulesVersion: row.rulesVersion, revision: row.revision, version: row.version, tasks: row.tasks.map(summary), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }; }
function taskView(row: any, siblings: any[]): PublicationTask { const availability = { VIDEO: row.renderOutput.videoAsset?.asset.status === 'AVAILABLE', SUBTITLE: row.renderOutput.subtitleAsset?.asset.status === 'AVAILABLE', THUMBNAIL: row.renderOutput.thumbnailAsset?.asset.status === 'AVAILABLE' }; const base = summary(row); const revisionHash = hash(row.fields.map((x: any) => x.currentRevisionId).join(':')); return { ...base, notes: row.notes, publishedAt: row.publishedAt?.toISOString() ?? null, contentSubjectVersion: `publication-task:${row.id}:package:${row.publishPackage.revision}:fields:${revisionHash}`, fields: row.fields.map((x: any) => ({ id: x.id, key: x.fieldKey, isLocked: x.isLocked, version: x.version, currentRevision: revisionView(x.currentRevision), revisions: x.revisions.map(revisionView) })), checklist: row.checklist.map((x: any) => ({ id: x.id, key: x.itemKey, label: x.labelSnapshot, isRequired: x.isRequired, status: x.status, ordinal: x.ordinal, completedAt: x.completedAt?.toISOString() ?? null })), proofs: row.proofs.map((x: any) => ({ id: x.id, attemptNumber: x.attemptNumber, platformPostId: x.platformPostId, publicUrl: x.publicUrl, verificationStatus: x.verificationStatus, submittedAt: x.submittedAt.toISOString(), verifiedAt: x.verifiedAt?.toISOString() ?? null, verificationDetail: x.verificationDetailSafe })), siblingTasks: siblings.map(summary), assetAvailability: availability }; }
function revisionView(row: any) { return row ? { id: row.id, revision: row.revision, value: row.valueText, origin: row.origin, createdAt: row.createdAt.toISOString() } : null; }
function missing(): never { return fail('PUBLICATION_TASK_NOT_FOUND', 'Publication task was not found'); }
function fail(code: string, message: string): never { throw new PublishingError(code, message); }
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`; return JSON.stringify(value); }
function replay<T>(oldHash: string, newHash: string, body: Prisma.JsonValue): T { if (oldHash !== newHash) fail('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was reused for another request'); return body as T; }
function encodeCursor(at: Date, id: string) { return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url'); }
function decodeCursor(value?: string) { if (!value) return null; try { const decoded = JSON.parse(Buffer.from(value, 'base64url').toString()) as { at: string; id: string }; const at = new Date(decoded.at); if (!decoded.id || Number.isNaN(at.valueOf())) throw new Error(); return { at, id: decoded.id }; } catch { fail('PUBLICATION_INVALID_TRANSITION', 'Publication cursor is invalid'); } }
