# Xóa video (hard delete hai pha) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người vận hành xóa hẳn được một video từ trang Chi tiết, hoặc nhiều video từ Thư viện. Video biến khỏi Thư viện ngay lúc bấm, còn object R2 và các dòng DB được một runner nền dọn sạch, có retry khi R2 lỗi.

**Architecture:** Có hai endpoint mới trong module `video-deletion`. Trong một transaction, endpoint chặn video có `PublicationProof`, hủy job active bằng hàm dùng chung với Queue, chuyển các asset liên quan sang `DELETING` rồi trả `202`. `VideoDeletionRunner` chạy trong process API, poll mỗi 2 s, claim một video `DELETING` bằng `FOR UPDATE SKIP LOCKED`, xóa từng object theo `bucket`/`objectKey`, rồi xóa cây dòng DB theo đúng thứ tự khóa ngoại. Web có nút "Xóa video" ở trang Chi tiết và có chọn nhiều ở Thư viện.

**Tech Stack:** NestJS 11 + Fastify, Prisma 6.19 (PostgreSQL 17), `@aws-sdk/client-s3`, Jest + ts-jest cho API, React 19 + TanStack Query + shadcn/Radix + Vitest + MSW cho web, OpenAPI 3.1 và `@hey-api/openapi-ts`.

**Spec:** `docs/superpowers/specs/2026-09-27-video-deletion-design.md`

## Global Constraints

- Node.js `>=24 <25`, pnpm `10.28`. Chạy lệnh từ repo root bằng `pnpm --filter @reup-dubbing-studio/<pkg> …`.
- Mọi wire model đi qua `contracts/openapi/web.openapi.yaml`, rồi chạy `pnpm contract:generate`. Không sửa tay file generated. Web chỉ import type/client từ `@reup-dubbing-studio/api-client`.
- Mọi khóa ngoại là `onDelete: Restrict`. Không thêm cascade: xóa bằng code, theo thứ tự, trong một transaction.
- Không xóa object R2 trong HTTP request. Không bao giờ xóa theo prefix: chỉ `DeleteObject(bucket, objectKey)` của từng dòng `Asset`.
- Asset được `VoiceProfileSample`, `ChannelProfileAsset`, `SeriesProfileAsset` hoặc một video khác tham chiếu thì không bao giờ bị xóa, cả object lẫn dòng.
- Video có ít nhất một `PublicationProof` thì không xóa được: `409 VIDEO_HAS_PUBLICATION_HISTORY`. Không có đường nào xóa `PublicationProof`.
- Hằng số: grace `15 phút`; lease mềm của runner `5 phút`; poll `2 s`; backoff `1, 5, 15, 60` phút; tối đa `6` lần thử, tới lần thứ 6 thì `DELETE_FAILED`; bulk nhận `1–100` item.
- Idempotency-Key theo quy ước Queue: 8–128 ký tự ASCII nhìn thấy được (`IngestIdempotencyKey`). `If-Match` là strong ETag số (`"<version>"`).
- Log của runner chỉ có `videoId` và mã lỗi an toàn, không có URL, key, bucket hay credential.
- UI copy bằng tiếng Việt, sentence case, động từ đứng đầu. Dùng lại shadcn `AlertDialog`, `Checkbox`, `Tooltip` và `Button variant="destructive"` đang có.
- API e2e cần `TEST_DATABASE_URL` trỏ tới DB test riêng, đã `prisma migrate deploy`. Xem "Chuẩn bị DB test" bên dưới.
- Commit message kết thúc bằng một dòng trống, rồi `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Chuẩn bị DB test (dùng cho mọi bước e2e)

```bash
docker run -d --name reup-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=reup_test -p 55432:5432 postgres:17-alpine
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/reup_test
DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @reup-dubbing-studio/api exec prisma migrate deploy
```

Sau Task 2, chạy lại `prisma migrate deploy` để áp migration mới. Dọn khi xong: `docker rm -f reup-test-pg`.

## Rulings (các chỗ plan chốt thay cho spec)

1. **Thứ tự xóa ở §3.4 pha 3 được sửa cho đúng khóa ngoại.** `WorkflowEvent`, `TranscriptRun`, `SegmentAudioRevision` và `Asset.createdByAttemptId` đều tham chiếu `TaskAttempt`, còn `RenderOutput` và `ReviewDecision` tham chiếu `PipelineJob`. Vì vậy phải xóa publication → render output → review → segment/transcript → video asset → workflow event → lease → asset → attempt → dependency/task/job → video. Spec đòi "đúng thứ tự khóa ngoại", và thứ tự trong spec không chạy được.
2. **Kiểm tra `DELETING` trước kiểm tra version.** Lần gọi lại với version cũ vẫn nhận `202`, đúng dòng "Đã `DELETING` → `202` (idempotent)" trong bảng §4. Nếu kiểm version trước thì mọi lần retry đều thành `412`.
3. **`capabilities` thêm `deleteBlockedReason: 'PUBLICATION_HISTORY' | 'DELETING' | null`.** Spec cần UI phân biệt "ẩn nút" (đang xóa) với "khóa nút kèm tooltip" (có lịch sử đăng), nhưng chỉ có `canDelete` thì không đủ để phân biệt.
4. **Asset còn được một video khác tham chiếu cũng được bảo vệ**, cùng cơ chế với asset của profile, theo tinh thần §5.
5. **Pha 3 hủy job active phát sinh sau khi yêu cầu xóa** (ví dụ có người bấm render lại trên video `DELETING`), đặt grace mới rồi lên lịch lại. Nó không xóa cây dữ liệu đang có worker giữ lease.
6. **Asset không phải `R2` (tức `LOCAL`/`S3`) không gọi object store.** Hiện chưa có store nào cho các backend đó, nên runner chỉ đánh dấu `DELETED` rồi xóa dòng.
7. **Integration kịch bản 2 (§6)** khẳng định trạng thái DB mà worker API dùng để trả `STALE_TASK_ATTEMPT`: attempt `CANCELLED`, lease `releasedAt` khác null, task `CANCELLED`. Chuỗi HTTP worker → `409` đã được `workers.e2e-spec.ts` phủ.
8. **Grace chặn cả pha 2 lẫn pha 3.** Spec ghi "chưa tới giờ thì … dừng tick", nên video vừa hủy job sẽ chờ đủ 15 phút rồi mới xóa dòng, kể cả khi không có asset `PENDING`.

## Review Focus

1. **Asset dùng chung với profile, voice sample hoặc một video khác.** Xóa video A không được đụng object hay dòng của asset đó, kể cả khi asset do attempt của A tạo ra (`createdByAttemptId`). Trong trường hợp đó, runner phải gỡ `createdByAttemptId` về `null`, rồi mới xóa attempt. Test: Task 4 (`collectVideoAssetIds`) và Task 8 (kịch bản 6).
2. **Worker upload muộn sau khi hủy.** Asset `PENDING` được tạo trước lúc hủy không được thành object mồ côi. Trước grace, runner không xóa dòng. Sau grace, runner xóa object theo key rồi mới xóa dòng. Test: Task 8 (kịch bản 4).
3. **Bấm xóa hai lần: double-click, retry mạng, hoặc hai tab.** Lần hai trả `202` với cùng envelope, không hủy job lần nữa, không ghi audit thêm. Cùng `Idempotency-Key` nhưng khác body thì `409 IDEMPOTENCY_KEY_REUSED`. Test: Task 6.
4. **R2 lỗi hoặc chưa cấu hình Settings.** Runner tăng `deletion_attempts`, lên lịch theo backoff, và tới lần 6 thì `DELETE_FAILED`. `DELETE` lại thì chạy tiếp. Video không bao giờ kẹt vĩnh viễn ở `DELETING`, và không bị xóa dòng khi object còn. Test: Task 7 (store) và Task 8 (kịch bản 5).
5. **Bulk có item hỏng giữa danh sách.** Item không tồn tại, sai version hay có lịch sử đăng không được làm rollback các item khác. Kết quả trả đúng thứ tự request, và UI gom thông báo theo nhóm. Test: Task 6 (API) và Task 9/11 (web).

---

## File Structure

**API — tạo mới** `apps/api/src/modules/video-deletion/`:

| File | Trách nhiệm |
| --- | --- |
| `index.ts` | Export `VideoDeletionModule`. |
| `video-deletion.module.ts` | Wiring Nest: Prisma, cipher, repository, object store, service, runner, controller. |
| `domain/video-deletion.ts` | Hằng số, type kết quả, `nextDeletionSchedule` (backoff thuần). |
| `domain/video-deletion-errors.ts` | `VideoDeletionError` và các code. |
| `infrastructure/video-asset-set.ts` | `collectVideoAssetIds(tx, videoId)`, `markAssetsDeleting(tx, ids)`: nguồn duy nhất của tập asset. |
| `infrastructure/prisma-video-deletion-repository.ts` | Yêu cầu xóa (một và nhiều), idempotency, và các thao tác DB của runner (claim, purge list, finalize). |
| `infrastructure/r2-video-deletion-object-store.ts` | `deleteObject(bucket, key)`: nơi duy nhất gọi `DeleteObjectCommand` cho asset. |
| `application/video-deletion.service.ts` | Validate input, hash request, gọi repository. |
| `application/video-deletion-runner.ts` | Vòng poll 3 pha, xử lý lỗi/backoff. |
| `http/web/video-deletion.controller.ts`, `video-deletion.dto.ts` | `DELETE /v1/videos/:videoId`, `POST /v1/videos/deletions`. |

**API — sửa:**

- `apps/api/prisma/schema.prisma` và migration mới `20260927100000_video_deletion`.
- `apps/api/src/modules/queue/infrastructure/cancel-job.ts` (mới), `prisma-queue-repository.ts`, `queue/index.ts`.
- `apps/api/src/modules/library/infrastructure/prisma-library-repository.ts`, `library/http/web/library.controller.ts`.
- `apps/api/src/app.module.ts`.

**Contract:** `contracts/openapi/web.openapi.yaml`, `packages/api-contract/src/generated/*` (generate), `packages/api-client/src/index.ts`, `packages/api-contract/test/video-deletion-contract.spec.ts`.

**Web:**

- Sửa `apps/web/src/features/library/api/library-api.ts`, `apps/web/src/routes/library/detail-page.tsx`, `apps/web/src/routes/library/page.tsx`, `apps/web/src/test/fixtures/control-plane.ts`.
- Tạo `apps/web/src/features/library/model/video-deletion.ts`, `apps/web/src/features/library/ui/delete-video-button.tsx`, `apps/web/src/features/library/ui/library-bulk-delete.tsx`, cùng các file test tương ứng.

**Test API mới:**

- `apps/api/test/unit/video-deletion-schedule.spec.ts`
- `apps/api/test/unit/video-deletion-object-store.spec.ts`
- `apps/api/test/integration/video-deletion-fixtures.ts`: helper, không phải spec.
- `apps/api/test/integration/video-deletion.e2e-spec.ts`

---

### Task 1: Contract xóa video

**Files:**
- Modify: `contracts/openapi/web.openapi.yaml`
- Generate: `packages/api-contract/src/generated/*`
- Modify: `packages/api-client/src/index.ts`
- Modify: `apps/web/src/test/fixtures/control-plane.ts:217-231`
- Test: `packages/api-contract/test/video-deletion-contract.spec.ts`

**Interfaces:**
- Produces: operation `deleteVideo` (`DELETE /videos/{videoId}`, header `If-Match` và `Idempotency-Key`, trả `202 VideoDeletionEnvelope`); operation `deleteVideos` (`POST /videos/deletions`, header `Idempotency-Key`, body `VideoBulkDeletionRequest`, trả `200 VideoBulkDeletionEnvelope`); type `VideoDeletion`, `VideoDeletionResult`, `VideoBulkDeletionRequest`, `VideoBulkDeletionItemResult`, `VideoBulkDeletionResult`; `Video.deletion: VideoDeletion | null`; `Video.capabilities.canDelete: boolean`; `Video.capabilities.deleteBlockedReason: 'PUBLICATION_HISTORY' | 'DELETING' | null`.

- [ ] **Step 1: Viết contract test (fail vì type chưa có)**

`packages/api-contract/test/video-deletion-contract.spec.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Video, VideoBulkDeletionItemResult, VideoBulkDeletionRequest, VideoDeletionResult } from '../src';

describe('Video deletion contract', () => {
  it('exposes deletion state and an explicit delete capability on Video', () => {
    expectTypeOf<Video['capabilities']['canDelete']>().toEqualTypeOf<boolean>();
    expectTypeOf<Video['capabilities']['deleteBlockedReason']>().toEqualTypeOf<'PUBLICATION_HISTORY' | 'DELETING' | null>();
    expectTypeOf<NonNullable<Video['deletion']>['errorCode']>().toEqualTypeOf<string | null>();
  });

  it('reports one result per requested video, in request order', () => {
    expectTypeOf<VideoBulkDeletionItemResult['result']>().toEqualTypeOf<'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND'>();
    expectTypeOf<VideoDeletionResult['status']>().toEqualTypeOf<'DELETING' | 'DELETE_FAILED'>();
    const request: VideoBulkDeletionRequest = { items: [{ videoId: '0191f3d2-7f5b-7abc-8b2e-123456789d01', version: 1 }] };
    expect(request.items).toHaveLength(1);
    expect(request).not.toHaveProperty('objectKey');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `pnpm --filter @reup-dubbing-studio/api-contract test`
Expected: FAIL (typecheck của vitest báo `VideoBulkDeletionItemResult` không được export, hoặc test lỗi import type).

- [ ] **Step 3: Sửa OpenAPI**

Trong `contracts/openapi/web.openapi.yaml`:

(a) Ngay **trước** `  /videos/{videoId}:` (dòng ~1146), thêm path mới:

```yaml
  /videos/deletions:
    post:
      summary: Yêu cầu xóa vĩnh viễn nhiều video
      operationId: deleteVideos
      parameters: [{ $ref: '#/components/parameters/IngestIdempotencyKey' }]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/VideoBulkDeletionRequest' } } } }
      responses:
        '200': { description: Kết quả theo từng video, đúng thứ tự request, content: { application/json: { schema: { $ref: '#/components/schemas/VideoBulkDeletionEnvelope' } } } }
        default: { $ref: '#/components/responses/Problem' }
```

(b) Trong path item `  /videos/{videoId}:`, sau khối `get:`, thêm:

```yaml
    delete:
      summary: Yêu cầu xóa vĩnh viễn video; object và dữ liệu được dọn ở nền
      operationId: deleteVideo
      parameters:
        - { $ref: '#/components/parameters/VideoId' }
        - { $ref: '#/components/parameters/VideoIfMatch' }
        - { $ref: '#/components/parameters/IngestIdempotencyKey' }
      responses:
        '202': { description: Video đang được xóa ở nền, content: { application/json: { schema: { $ref: '#/components/schemas/VideoDeletionEnvelope' } } } }
        default: { $ref: '#/components/responses/Problem' }
```

(c) Trong `components.parameters`, sau `QueueIfMatch`, thêm:

```yaml
    VideoIfMatch:
      name: If-Match
      in: header
      required: true
      description: Strong ETag nhận từ lần đọc video gần nhất.
      schema: { type: string, pattern: '^"[1-9][0-9]*"$' }
```

(d) Trong schema `Video`:

- thêm `deletion` vào `required` (đặt sau `archivedAt`);
- thêm property
  `deletion: { oneOf: [{ $ref: '#/components/schemas/VideoDeletion' }, { type: 'null' }] }`;
- thay dòng `capabilities` bằng:

```yaml
        capabilities:
          type: object
          required: [canOpenStudio, canOpenPublishing, canArchive, canDelete, deleteBlockedReason]
          properties:
            canOpenStudio: { type: boolean }
            canOpenPublishing: { type: boolean }
            canArchive: { type: boolean }
            canDelete: { type: boolean }
            deleteBlockedReason: { type: [string, 'null'], enum: [PUBLICATION_HISTORY, DELETING, null] }
```

(e) Sau schema `VideoEnvelope`, thêm:

```yaml
    VideoDeletion:
      type: object
      additionalProperties: false
      required: [requestedAt, errorCode]
      properties:
        requestedAt: { type: string, format: date-time }
        errorCode: { type: [string, 'null'] }
    VideoDeletionResult:
      type: object
      additionalProperties: false
      required: [videoId, status, cancelledJobIds]
      properties:
        videoId: { $ref: '#/components/schemas/UuidV7' }
        status: { type: string, enum: [DELETING, DELETE_FAILED] }
        cancelledJobIds: { type: array, items: { $ref: '#/components/schemas/UuidV7' } }
    VideoDeletionEnvelope:
      type: object
      required: [data]
      properties: { data: { $ref: '#/components/schemas/VideoDeletionResult' } }
    VideoBulkDeletionRequest:
      type: object
      additionalProperties: false
      required: [items]
      properties:
        items:
          type: array
          minItems: 1
          maxItems: 100
          items:
            type: object
            additionalProperties: false
            required: [videoId, version]
            properties:
              videoId: { $ref: '#/components/schemas/UuidV7' }
              version: { type: integer, minimum: 1 }
    VideoBulkDeletionItemResult:
      type: object
      additionalProperties: false
      required: [videoId, result, cancelledJobIds]
      properties:
        videoId: { $ref: '#/components/schemas/UuidV7' }
        result: { type: string, enum: [ACCEPTED, ALREADY_DELETING, HAS_PUBLICATION_HISTORY, VERSION_CONFLICT, NOT_FOUND] }
        cancelledJobIds: { type: array, items: { $ref: '#/components/schemas/UuidV7' } }
    VideoBulkDeletionResult:
      type: object
      additionalProperties: false
      required: [items]
      properties: { items: { type: array, items: { $ref: '#/components/schemas/VideoBulkDeletionItemResult' } } }
    VideoBulkDeletionEnvelope:
      type: object
      required: [data]
      properties: { data: { $ref: '#/components/schemas/VideoBulkDeletionResult' } }
```

(f) Trong enum `code` của `ProblemDetails` (dòng ~3470–3549), thêm vào cuối danh sách:

```yaml
            - VIDEO_NOT_FOUND
            - VIDEO_VERSION_CONFLICT
            - VIDEO_HAS_PUBLICATION_HISTORY
            - VIDEO_DELETING
            - VIDEO_DELETION_VALIDATION_FAILED
```

- [ ] **Step 4: Lint và generate contract**

Run: `pnpm contract:lint && pnpm contract:generate`
Expected: lint không có error; `packages/api-contract/src/generated/sdk.gen.ts` có `deleteVideo` và `deleteVideos`.

- [ ] **Step 5: Export qua api-client**

Trong `packages/api-client/src/index.ts`:

- sau `grantVideoOutput,` thêm `deleteVideo,` và `deleteVideos,`;
- sau `type VideoOutputPart,` thêm:

```ts
  type VideoDeletion,
  type VideoDeletionResult,
  type VideoDeletionEnvelope,
  type VideoBulkDeletionRequest,
  type VideoBulkDeletionItemResult,
  type VideoBulkDeletionResult,
  type VideoBulkDeletionEnvelope,
```

- [ ] **Step 6: Cập nhật fixture web để còn `satisfies Video`**

Trong `apps/web/src/test/fixtures/control-plane.ts`, ở `libraryVideo`:

- thay `archivedAt: null,` bằng `archivedAt: null, deletion: null,`;
- thay dòng `capabilities` bằng
  `capabilities: { canOpenStudio: true, canOpenPublishing: false, canArchive: false, canDelete: true, deleteBlockedReason: null },`.

- [ ] **Step 7: Chạy lại test và verify**

Run: `pnpm contract:verify && pnpm --filter @reup-dubbing-studio/web typecheck`
Expected: PASS. `contract:check` đòi generated khớp git diff, nên phải `git add` generated trước khi chạy, hoặc chạy sau commit.

- [ ] **Step 8: Commit**

```bash
git add contracts/openapi/web.openapi.yaml packages/api-contract packages/api-client/src/index.ts apps/web/src/test/fixtures/control-plane.ts
git commit -m "feat(contract): video deletion endpoints and state"
```

---

### Task 2: Schema và migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum `VideoStatus` dòng 267, model `Video` dòng 835)
- Create: `apps/api/prisma/migrations/20260927100000_video_deletion/migration.sql`

**Interfaces:**
- Produces:
  - `VideoStatus` có thêm `DELETING` và `DELETE_FAILED`;
  - Prisma `Video` có thêm `deletionRequestedAt: Date | null`, `deletionAttempts: number`, `deletionNextAttemptAt: Date | null`, `deletionErrorCode: string | null`, `deletionGraceUntil: Date | null`;
  - cột SQL tương ứng: `deletion_requested_at`, `deletion_attempts`, `deletion_next_attempt_at`, `deletion_error_code`, `deletion_grace_until`.

- [ ] **Step 1: Sửa schema**

Trong `enum VideoStatus`, sau `ARCHIVED`, thêm hai dòng `DELETING` và `DELETE_FAILED`.

Trong `model Video`, sau `version Int @default(1)`, thêm:

```prisma
  deletionRequestedAt   DateTime?       @map("deletion_requested_at") @db.Timestamptz(6)
  deletionAttempts      Int             @default(0) @map("deletion_attempts")
  deletionNextAttemptAt DateTime?       @map("deletion_next_attempt_at") @db.Timestamptz(6)
  deletionErrorCode     String?         @map("deletion_error_code")
  deletionGraceUntil    DateTime?       @map("deletion_grace_until") @db.Timestamptz(6)
```

Sau `@@index([status, updatedAt, id])`, thêm `@@index([status, deletionNextAttemptAt])`.

- [ ] **Step 2: Viết migration**

`apps/api/prisma/migrations/20260927100000_video_deletion/migration.sql`:

```sql
ALTER TYPE "VideoStatus" ADD VALUE 'DELETING';
ALTER TYPE "VideoStatus" ADD VALUE 'DELETE_FAILED';

ALTER TABLE "videos"
  ADD COLUMN "deletion_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN "deletion_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletion_next_attempt_at" TIMESTAMPTZ(6),
  ADD COLUMN "deletion_error_code" TEXT,
  ADD COLUMN "deletion_grace_until" TIMESTAMPTZ(6);

CREATE INDEX "videos_status_deletion_next_attempt_at_idx" ON "videos"("status", "deletion_next_attempt_at");
```

- [ ] **Step 3: Áp migration và kiểm schema khớp DB**

```bash
DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @reup-dubbing-studio/api exec prisma migrate deploy
pnpm --filter @reup-dubbing-studio/api exec prisma migrate diff --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
pnpm --filter @reup-dubbing-studio/api prisma:generate
```

Expected: `migrate deploy` áp `20260927100000_video_deletion`; `migrate diff` in "No difference detected." với exit 0.

- [ ] **Step 4: Typecheck và test hiện có**

Run: `pnpm --filter @reup-dubbing-studio/api typecheck && pnpm --filter @reup-dubbing-studio/api test`
Expected: PASS. Dashboard dùng danh sách status cố định, nên không đổi.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): video deletion columns and statuses"
```

---

### Task 3: Tách hàm hủy job dùng chung

**Files:**
- Create: `apps/api/src/modules/queue/infrastructure/cancel-job.ts`
- Modify: `apps/api/src/modules/queue/infrastructure/prisma-queue-repository.ts:7,194,257-264,265-271,274`
- Modify: `apps/api/src/modules/queue/index.ts`
- Test: `apps/api/test/integration/ingest.e2e-spec.ts` (test cancel/retry đã có, dùng làm regression)

**Interfaces:**
- Produces (export qua `modules/queue/index.ts`):
  - `ACTIVE_JOB_STATUSES: readonly ['QUEUED','RUNNING','WAITING_FOR_GPU','WAITING_FOR_REVIEW']`;
  - `cancelJobInTransaction(tx: Prisma.TransactionClient, jobId: string, reason: string | null, requestId?: string): Promise<boolean>`: trả `true` nếu đã hủy, `false` nếu job không tồn tại hoặc không active;
  - `recordJobEvent(tx, job: { id: string; videoId: string; status: string; version: number }, eventType: string, toStatus: string, message: string | null, requestId?: string, taskId?: string): Promise<void>`.

- [ ] **Step 1: Chạy regression trước khi sửa (baseline)**

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/ingest.e2e-spec.ts`
Expected: PASS. Đây là baseline của cancel/retry.

- [ ] **Step 2: Tạo `cancel-job.ts`**

```ts
import type { Prisma } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
export const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW'] as const;
type EventJob = { id: string; videoId: string; status: string; version: number };

/**
 * Cancels one active job inside the caller's transaction. Tasks stop, leases are released and
 * STARTED attempts become CANCELLED, so a worker's late progress/complete gets STALE_TASK_ATTEMPT.
 * Returns false when the job is missing or no longer active.
 */
export async function cancelJobInTransaction(tx: Prisma.TransactionClient, jobId: string, reason: string | null, requestId?: string): Promise<boolean> {
  const job = await tx.pipelineJob.findUnique({ where: { id: jobId }, select: { id: true, videoId: true, status: true, version: true } });
  if (!job || !ACTIVE_JOB_STATUSES.includes(job.status as typeof ACTIVE_JOB_STATUSES[number])) return false;
  const now = new Date();
  await tx.pipelineTask.updateMany({ where: { pipelineJobId: jobId, status: { notIn: ['SUCCEEDED', 'CANCELLED'] } }, data: { status: 'CANCELLED', version: { increment: 1 } } });
  await tx.taskLease.updateMany({ where: { pipelineTask: { pipelineJobId: jobId }, releasedAt: null }, data: { releasedAt: now, releaseReason: 'JOB_CANCELLED' } });
  await tx.taskAttempt.updateMany({ where: { pipelineTask: { pipelineJobId: jobId }, status: 'STARTED' }, data: { status: 'CANCELLED', finishedAt: now } });
  await tx.pipelineJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', finishedAt: now, version: { increment: 1 } } });
  await recordJobEvent(tx, job, 'JOB_CANCELLED', 'CANCELLED', reason, requestId);
  return true;
}

export async function recordJobEvent(tx: Prisma.TransactionClient, job: EventJob, eventType: string, toStatus: string, message: string | null, requestId?: string, taskId?: string): Promise<void> {
  await tx.workflowEvent.create({ data: { id: uuidV7(), videoId: job.videoId, pipelineJobId: job.id, pipelineTaskId: taskId ?? null, eventType, fromStatus: job.status, toStatus, actorType: 'USER', actorId: OWNER_ID, messageSafe: message, payloadSafe: {} } });
  await tx.auditEvent.create({ data: { id: uuidV7(), actorType: 'USER', actorId: OWNER_ID, action: eventType, entityType: 'PIPELINE_JOB', entityId: job.id, requestId: requestId ?? null, beforeSafe: { status: job.status, version: job.version }, afterSafe: { status: toStatus, version: job.version + 1 }, metadataSafe: { reason: message, taskId: taskId ?? null } } });
  await tx.outboxMessage.create({ data: { id: uuidV7(), aggregateType: 'PIPELINE_JOB', aggregateId: job.id, eventType: 'queue.invalidate', payloadSafe: { entity: 'JOB', jobId: job.id, jobVersion: job.version + 1, reason: eventType } } });
}
```

- [ ] **Step 3: Dùng lại trong `PrismaQueueRepository`**

- Thêm import `import { ACTIVE_JOB_STATUSES as ACTIVE, cancelJobInTransaction, recordJobEvent } from './cancel-job';` và xóa dòng `const ACTIVE = [...]` (dòng 194).
- Trong `cancel(...)`, thay khối `if (job.status !== 'CANCELLED') { const now = …; … await this.recordEvent(…); }` bằng
  `if (job.status !== 'CANCELLED') await cancelJobInTransaction(tx, id, reason, requestId);`.
- Trong `retry(...)`, thay `await this.recordEvent(tx, job, 'JOB_RETRIED', 'QUEUED', reason ?? null, requestId, failed.id);` bằng
  `await recordJobEvent(tx, job, 'JOB_RETRIED', 'QUEUED', reason ?? null, requestId, failed.id);`.
- Xóa private method `recordEvent` (dòng 274). Xóa import `uuidV7` nếu không còn dùng (vẫn còn dùng trong `mutate`, nên giữ).

- [ ] **Step 4: Export qua index của Queue**

`apps/api/src/modules/queue/index.ts`:

```ts
export { QueueModule } from './queue.module';
export { ACTIVE_JOB_STATUSES, cancelJobInTransaction } from './infrastructure/cancel-job';
```

- [ ] **Step 5: Chạy regression**

Run: `pnpm --filter @reup-dubbing-studio/api typecheck && pnpm --filter @reup-dubbing-studio/api lint && pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/ingest.e2e-spec.ts`
Expected: PASS, cùng kết quả với baseline (cancel `200`, replay idempotent, `412` khi version cũ, `409 JOB_NOT_CANCELLABLE` khi terminal).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/queue
git commit -m "refactor(api): share job cancellation inside a transaction"
```

---

### Task 4: Domain xóa video và tập asset thuộc video

**Files:**
- Create: `apps/api/src/modules/video-deletion/domain/video-deletion.ts`
- Create: `apps/api/src/modules/video-deletion/domain/video-deletion-errors.ts`
- Create: `apps/api/src/modules/video-deletion/infrastructure/video-asset-set.ts`
- Create: `apps/api/test/integration/video-deletion-fixtures.ts`
- Test: `apps/api/test/unit/video-deletion-schedule.spec.ts`, `apps/api/test/integration/video-deletion.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `DELETION_GRACE_MS = 900_000`, `DELETION_LEASE_MS = 300_000`, `MAX_DELETION_ATTEMPTS = 6`;
  - `nextDeletionSchedule(failedAttempts: number, now: Date): { status: 'DELETING' | 'DELETE_FAILED'; nextAttemptAt: Date | null }`;
  - `type BulkDeletionResult = 'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND'`;
  - `type VideoDeletionEnvelope = { videoId: string; status: 'DELETING' | 'DELETE_FAILED'; cancelledJobIds: string[] }`;
  - `class VideoDeletionError(code: VideoDeletionErrorCode, message)`;
  - `collectVideoAssetIds(tx: Prisma.TransactionClient, videoId: string): Promise<string[]>` (đã sort, không trùng);
  - `markAssetsDeleting(tx, assetIds: string[]): Promise<{ pending: number }>`;
  - fixture `seedVideoTree(prisma, options?)` và `cleanupVideoTree(prisma, seeded)`.

- [ ] **Step 1: Viết unit test backoff (fail)**

`apps/api/test/unit/video-deletion-schedule.spec.ts`:

```ts
import { MAX_DELETION_ATTEMPTS, nextDeletionSchedule } from '../../src/modules/video-deletion/domain/video-deletion';

describe('nextDeletionSchedule', () => {
  const now = new Date('2026-09-27T10:00:00.000Z');
  const minutes = (failed: number) => (nextDeletionSchedule(failed, now).nextAttemptAt!.getTime() - now.getTime()) / 60_000;

  it('backs off 1, 5, 15 then 60 minutes', () => {
    expect([1, 2, 3, 4, 5].map(minutes)).toEqual([1, 5, 15, 60, 60]);
    expect(nextDeletionSchedule(5, now).status).toBe('DELETING');
  });

  it('gives up on the sixth failure', () => {
    expect(MAX_DELETION_ATTEMPTS).toBe(6);
    expect(nextDeletionSchedule(6, now)).toEqual({ status: 'DELETE_FAILED', nextAttemptAt: null });
    expect(nextDeletionSchedule(9, now).status).toBe('DELETE_FAILED');
  });
});
```

Run: `pnpm --filter @reup-dubbing-studio/api test -- video-deletion-schedule`
Expected: FAIL (`Cannot find module …/video-deletion`).

- [ ] **Step 2: Viết domain**

`domain/video-deletion.ts`:

```ts
export const DELETION_GRACE_MS = 15 * 60_000;
export const DELETION_LEASE_MS = 5 * 60_000;
export const MAX_DELETION_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export type BulkDeletionResult = 'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND';
export type VideoDeletionEnvelope = { videoId: string; status: 'DELETING' | 'DELETE_FAILED'; cancelledJobIds: string[] };
export type DeletionOutcome = { result: BulkDeletionResult; envelope: VideoDeletionEnvelope | null };

/** Schedule after the Nth consecutive failure; the sixth failure stops retrying. */
export function nextDeletionSchedule(failedAttempts: number, now: Date): { status: 'DELETING' | 'DELETE_FAILED'; nextAttemptAt: Date | null } {
  if (failedAttempts >= MAX_DELETION_ATTEMPTS) return { status: 'DELETE_FAILED', nextAttemptAt: null };
  const delay = BACKOFF_MINUTES[Math.min(Math.max(failedAttempts, 1), BACKOFF_MINUTES.length) - 1]!;
  return { status: 'DELETING', nextAttemptAt: new Date(now.getTime() + delay * 60_000) };
}
```

`domain/video-deletion-errors.ts`:

```ts
export type VideoDeletionErrorCode =
  | 'VIDEO_NOT_FOUND' | 'VIDEO_VERSION_CONFLICT' | 'VIDEO_HAS_PUBLICATION_HISTORY' | 'VIDEO_DELETION_VALIDATION_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED' | 'STORAGE_NOT_CONFIGURED' | 'STORAGE_BUCKET_MISMATCH' | 'STORAGE_DELETE_FAILED';
export class VideoDeletionError extends Error { constructor(readonly code: VideoDeletionErrorCode, message: string) { super(message); this.name = 'VideoDeletionError'; } }
```

Run lại test ở Step 1. Expected: PASS.

- [ ] **Step 3: Viết fixture dựng một cây video đầy đủ**

`apps/api/test/integration/video-deletion-fixtures.ts`:

```ts
import type { PipelineJobStatus, PrismaClient } from '@prisma/client';
import { uuidV7 } from '../../src/platform/ids/uuid-v7';

export type SeededVideo = Awaited<ReturnType<typeof seedVideoTree>>;
type Options = { jobStatus?: PipelineJobStatus; withProof?: boolean; pendingOutput?: boolean; sharedWithChannel?: boolean };

/** One local video with every child table the deletion must clear, plus a channel voice sample and asset that must survive. */
export async function seedVideoTree(prisma: PrismaClient, options: Options = {}) {
  const ids = { user: uuidV7(), channel: uuidV7(), voice: uuidV7(), video: uuidV7(), job: uuidV7(), task: uuidV7(), attempt: uuidV7(), lease: uuidV7(), run: uuidV7(), transcriptSegment: uuidV7(), segment: uuidV7(), revision: uuidV7(), destination: uuidV7(), pkg: uuidV7(), pubTask: uuidV7(), field: uuidV7(), fieldRevision: uuidV7(), renderOutput: uuidV7() };
  const asset = { raw: uuidV7(), transcript: uuidV7(), audio: uuidV7(), output: uuidV7(), pending: uuidV7(), voiceSample: uuidV7(), channelAsset: uuidV7() };
  const active = ['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW'].includes(options.jobStatus ?? 'SUCCEEDED');
  const now = new Date();
  await prisma.user.create({ data: { id: ids.user, displayName: 'Video deletion test user' } });
  await prisma.voiceProfile.create({ data: { id: ids.voice, name: `Deletion voice ${ids.voice}`, normalizedName: `deletion-voice-${ids.voice}`, primaryLanguage: 'vi', status: 'READY' } });
  await prisma.channelProfile.create({ data: { id: ids.channel, name: `Deletion channel ${ids.channel}`, normalizedName: `deletion-channel-${ids.channel}`, status: 'ACTIVE', targetLanguage: 'vi', subtitleLanguage: 'vi', subtitleFilenameRule: '{slug}.srt' } });
  const r2 = (id: string, status: 'AVAILABLE' | 'PENDING' = 'AVAILABLE', createdByAttemptId: string | null = null) => ({ id, storageBackend: 'R2' as const, bucket: 'test-bucket', objectKey: `videos/${ids.video}/${id}`, fileName: `${id}.bin`, status, byteSize: 10n, createdByAttemptId });
  await prisma.asset.createMany({ data: [r2(asset.raw), r2(asset.voiceSample), r2(asset.channelAsset)] });
  await prisma.voiceProfileSample.create({ data: { id: uuidV7(), voiceProfileId: ids.voice, assetId: asset.voiceSample, language: 'vi', transcript: 'mẫu', durationMs: 5_000, revision: 1 } });
  await prisma.channelProfileAsset.create({ data: { id: uuidV7(), channelProfileId: ids.channel, assetId: asset.channelAsset, role: 'LOGO', revision: 1 } });
  await prisma.video.create({ data: { id: ids.video, sourceKind: 'LOCAL_UPLOAD', localSourceMetadata: { durationMs: 1_000 }, channelProfileId: ids.channel, status: active ? 'PROCESSING' : 'READY_TO_PUBLISH', sourceLanguage: 'zh', targetLanguage: 'vi', displayTitle: 'Video sẽ bị xóa', createdById: ids.user } });
  await prisma.pipelineJob.create({ data: { id: ids.job, videoId: ids.video, kind: 'FULL_PIPELINE', status: options.jobStatus ?? 'SUCCEEDED', pipelineVersion: 'video-deletion-test', profileSnapshot: {}, requestedOutputs: {}, tasks: { create: { id: ids.task, taskType: 'RENDER', resourceClass: 'GPU_BATCH', status: active ? 'RUNNING' : 'SUCCEEDED', inputManifest: {} } } } });
  await prisma.taskAttempt.create({ data: { id: ids.attempt, pipelineTaskId: ids.task, attemptNumber: 1, executorKind: 'WORKER', executorInstanceId: 'deletion-test', status: active ? 'STARTED' : 'SUCCEEDED', startedAt: now } });
  await prisma.taskLease.create({ data: { id: ids.lease, pipelineTaskId: ids.task, taskAttemptId: ids.attempt, executorKind: 'WORKER', executorInstanceId: 'deletion-test', fencingToken: 1n, leasedAt: now, renewedAt: now, expiresAt: new Date(now.getTime() + 60_000), ...(active ? {} : { releasedAt: now, releaseReason: 'COMPLETED' }) } });
  await prisma.asset.createMany({ data: [r2(asset.transcript, 'AVAILABLE', ids.attempt), r2(asset.audio, 'AVAILABLE', ids.attempt), r2(asset.output, 'AVAILABLE', ids.attempt), ...(options.pendingOutput ? [r2(asset.pending, 'PENDING', ids.attempt)] : [])] });
  if (options.sharedWithChannel) await prisma.channelProfileAsset.create({ data: { id: uuidV7(), channelProfileId: ids.channel, assetId: asset.output, role: 'INTRO', revision: 1 } });
  await prisma.workflowEvent.create({ data: { id: uuidV7(), videoId: ids.video, pipelineJobId: ids.job, pipelineTaskId: ids.task, taskAttemptId: ids.attempt, eventType: 'TASK_STARTED', actorType: 'SYSTEM' } });
  await prisma.transcriptRun.create({ data: { id: ids.run, videoId: ids.video, method: 'ASR', status: 'SELECTED', language: 'zh', taskAttemptId: ids.attempt, rawAssetId: asset.transcript, segments: { create: { id: ids.transcriptSegment, ordinal: 0, startMs: 0, endMs: 1_000, text: '你好' } } } });
  await prisma.videoSegment.create({ data: { id: ids.segment, videoId: ids.video, ordinal: 0, sourceStartMs: 0, sourceEndMs: 1_000, sourceSegmentId: ids.transcriptSegment } });
  await prisma.segmentRevision.create({ data: { id: ids.revision, videoSegmentId: ids.segment, revision: 1, sourceText: '你好', translatedText: 'Xin chào', voiceProfileId: ids.voice, targetStartMs: 0, targetEndMs: 1_000 } });
  await prisma.videoSegment.update({ where: { id: ids.segment }, data: { currentRevisionId: ids.revision } });
  await prisma.segmentAudioRevision.create({ data: { id: uuidV7(), videoSegmentId: ids.segment, segmentRevisionId: ids.revision, assetId: asset.audio, taskAttemptId: ids.attempt, revision: 1, modelName: 'omnivoice', modelVersion: '1', targetDurationMs: 1_000, status: 'SELECTED' } });
  const rawLink = uuidV7(); const outputLink = uuidV7();
  await prisma.videoAsset.createMany({ data: [{ id: rawLink, videoId: ids.video, assetId: asset.raw, kind: 'RAW' }, { id: outputLink, videoId: ids.video, assetId: asset.output, kind: 'OUTPUT_VIDEO', variantKey: 'FULL_16X9' }] });
  await prisma.renderOutput.create({ data: { id: ids.renderOutput, videoId: ids.video, pipelineJobId: ids.job, variant: 'FULL_16X9', videoAssetId: outputLink, status: 'READY' } });
  await prisma.reviewDecision.create({ data: { id: uuidV7(), videoId: ids.video, pipelineJobId: ids.job, scope: 'RENDER', subjectVersion: '1', decision: 'APPROVED', decidedBy: ids.user } });
  await prisma.publishingDestination.create({ data: { id: ids.destination, channelProfileId: ids.channel, platform: 'YOUTUBE', displayName: 'Kênh test', normalizedName: `kenh-test-${ids.destination}` } });
  await prisma.publishPackage.create({ data: { id: ids.pkg, videoId: ids.video, channelProfileId: ids.channel, contextSnapshot: {}, rulesVersion: '1', revision: 1, createdBy: ids.user } });
  await prisma.publicationTask.create({ data: { id: ids.pubTask, publishPackageId: ids.pkg, destinationId: ids.destination, renderOutputId: ids.renderOutput, destinationSnapshot: {} } });
  await prisma.publicationField.create({ data: { id: ids.field, publicationTaskId: ids.pubTask, fieldKey: 'title' } });
  await prisma.publicationFieldRevision.create({ data: { id: ids.fieldRevision, publicationFieldId: ids.field, revision: 1, valueText: 'Tiêu đề', origin: 'GENERATED', createdBy: ids.user } });
  await prisma.publicationField.update({ where: { id: ids.field }, data: { currentRevisionId: ids.fieldRevision } });
  await prisma.publicationChecklistItem.create({ data: { id: uuidV7(), publicationTaskId: ids.pubTask, itemKey: 'title', labelSnapshot: 'Tiêu đề', isRequired: true, ordinal: 0 } });
  if (options.withProof) await prisma.publicationProof.create({ data: { id: uuidV7(), publicationTaskId: ids.pubTask, attemptNumber: 1, contentSnapshot: {}, submittedBy: ids.user } });
  return { ids, asset, videoAssetIds: [asset.raw, asset.transcript, asset.audio, asset.output, ...(options.pendingOutput ? [asset.pending] : [])] };
}

/** Removes whatever is left of a seeded tree, whether or not deletion ran. */
export async function cleanupVideoTree(prisma: PrismaClient, seeded: SeededVideo) {
  const { ids, asset } = seeded;
  const tasks = [ids.task]; const attempts = [ids.attempt];
  await prisma.publicationField.updateMany({ where: { id: ids.field }, data: { currentRevisionId: null } });
  await prisma.publicationProof.deleteMany({ where: { publicationTaskId: ids.pubTask } });
  await prisma.publicationFieldRevision.deleteMany({ where: { publicationFieldId: ids.field } });
  await prisma.publicationField.deleteMany({ where: { id: ids.field } });
  await prisma.publicationChecklistItem.deleteMany({ where: { publicationTaskId: ids.pubTask } });
  await prisma.publicationTask.deleteMany({ where: { id: ids.pubTask } });
  await prisma.publishPackage.deleteMany({ where: { id: ids.pkg } });
  await prisma.publishingDestination.deleteMany({ where: { id: ids.destination } });
  await prisma.renderOutput.deleteMany({ where: { videoId: ids.video } });
  await prisma.reviewDecision.deleteMany({ where: { videoId: ids.video } });
  await prisma.segmentAudioRevision.deleteMany({ where: { videoSegmentId: ids.segment } });
  await prisma.videoSegment.updateMany({ where: { videoId: ids.video }, data: { currentRevisionId: null } });
  await prisma.segmentRevision.deleteMany({ where: { videoSegmentId: ids.segment } });
  await prisma.videoSegment.deleteMany({ where: { videoId: ids.video } });
  await prisma.transcriptSegment.deleteMany({ where: { transcriptRunId: ids.run } });
  await prisma.transcriptRun.deleteMany({ where: { videoId: ids.video } });
  await prisma.videoAsset.deleteMany({ where: { videoId: ids.video } });
  await prisma.workflowEvent.deleteMany({ where: { OR: [{ videoId: ids.video }, { pipelineJobId: ids.job }] } });
  await prisma.outboxMessage.deleteMany({ where: { aggregateId: ids.job } });
  await prisma.taskLease.deleteMany({ where: { pipelineTaskId: { in: tasks } } });
  await prisma.channelProfileAsset.deleteMany({ where: { channelProfileId: ids.channel } });
  await prisma.voiceProfileSample.deleteMany({ where: { voiceProfileId: ids.voice } });
  await prisma.asset.deleteMany({ where: { id: { in: Object.values(asset) } } });
  await prisma.taskAttempt.deleteMany({ where: { id: { in: attempts } } });
  await prisma.pipelineTask.deleteMany({ where: { id: { in: tasks } } });
  await prisma.pipelineJob.deleteMany({ where: { videoId: ids.video } });
  await prisma.video.deleteMany({ where: { id: ids.video } });
  await prisma.channelProfile.deleteMany({ where: { id: ids.channel } });
  await prisma.voiceProfile.deleteMany({ where: { id: ids.voice } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}
```

- [ ] **Step 4: Viết e2e cho tập asset (fail)**

`apps/api/test/integration/video-deletion.e2e-spec.ts` (file này sẽ được mở rộng ở Task 5, 6, 8):

```ts
import { PrismaClient } from '@prisma/client';
import { collectVideoAssetIds } from '../../src/modules/video-deletion/infrastructure/video-asset-set';
import { cleanupVideoTree, seedVideoTree, type SeededVideo } from './video-deletion-fixtures';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Video deletion with PostgreSQL', () => {
  let prisma: PrismaClient; const seeded: SeededVideo[] = [];
  beforeAll(() => { prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } }); });
  afterAll(async () => { for (const item of seeded) await cleanupVideoTree(prisma, item); await prisma?.$disconnect(); });
  const seed = async (options?: Parameters<typeof seedVideoTree>[1]) => { const item = await seedVideoTree(prisma, options); seeded.push(item); return item; };

  describe('collectVideoAssetIds', () => {
    it('unions links, audio, transcript and attempt outputs, including PENDING ones', async () => {
      const video = await seed({ pendingOutput: true });
      const ids = await prisma.$transaction((tx) => collectVideoAssetIds(tx, video.ids.video));
      expect(ids).toEqual([...video.videoAssetIds].sort());
    });

    it('never includes voice sample, channel or shared assets', async () => {
      const video = await seed({ sharedWithChannel: true });
      const ids = await prisma.$transaction((tx) => collectVideoAssetIds(tx, video.ids.video));
      expect(ids).not.toContain(video.asset.voiceSample);
      expect(ids).not.toContain(video.asset.channelAsset);
      expect(ids).not.toContain(video.asset.output);
      expect(ids).toContain(video.asset.raw);
    });
  });
});
```

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts`
Expected: FAIL (`Cannot find module …/video-asset-set`).

- [ ] **Step 5: Viết `video-asset-set.ts`**

```ts
import type { Prisma } from '@prisma/client';

/**
 * The single definition of "the files of video V": its links, segment audio, transcript raw files and
 * everything its attempts created (PENDING uploads included), minus any asset another aggregate
 * (voice sample, channel, series, another video) still references.
 */
export async function collectVideoAssetIds(tx: Prisma.TransactionClient, videoId: string): Promise<string[]> {
  const links = await tx.videoAsset.findMany({ where: { videoId }, select: { assetId: true } });
  const audio = await tx.segmentAudioRevision.findMany({ where: { segment: { videoId }, assetId: { not: null } }, select: { assetId: true } });
  const runs = await tx.transcriptRun.findMany({ where: { videoId, rawAssetId: { not: null } }, select: { rawAssetId: true } });
  const created = await tx.asset.findMany({ where: { createdByAttempt: { pipelineTask: { pipelineJob: { videoId } } } }, select: { id: true } });
  const candidates = [...new Set([...links.map((row) => row.assetId), ...audio.map((row) => row.assetId!), ...runs.map((row) => row.rawAssetId!), ...created.map((row) => row.id)])];
  if (!candidates.length) return [];
  const shared = await tx.asset.findMany({ where: { id: { in: candidates }, OR: [
    { voiceSamples: { some: {} } }, { channelLinks: { some: {} } }, { seriesLinks: { some: {} } },
    { videoAssets: { some: { videoId: { not: videoId } } } },
    { transcriptRuns: { some: { videoId: { not: videoId } } } },
    { segmentAudioRevisions: { some: { segment: { videoId: { not: videoId } } } } },
  ] }, select: { id: true } });
  const keep = new Set(shared.map((row) => row.id));
  return candidates.filter((id) => !keep.has(id)).sort();
}

/** Moves AVAILABLE/PENDING/FAILED assets to DELETING and remembers the status each one came from. */
export async function markAssetsDeleting(tx: Prisma.TransactionClient, assetIds: string[]): Promise<{ pending: number }> {
  if (!assetIds.length) return { pending: 0 };
  const pending = await tx.asset.count({ where: { id: { in: assetIds }, status: 'PENDING' } });
  await tx.$executeRaw`UPDATE "assets" SET "status" = 'DELETING', "metadata" = "metadata" || jsonb_build_object('deletion', jsonb_build_object('previousStatus', "status"::text)), "version" = "version" + 1, "updated_at" = now() WHERE "id" = ANY(${assetIds}::uuid[]) AND "status" IN ('AVAILABLE', 'PENDING', 'FAILED')`;
  return { pending };
}
```

- [ ] **Step 6: Chạy test**

Run: `pnpm --filter @reup-dubbing-studio/api test -- video-deletion-schedule && pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts && pnpm --filter @reup-dubbing-studio/api typecheck && pnpm --filter @reup-dubbing-studio/api lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/video-deletion apps/api/test/unit/video-deletion-schedule.spec.ts apps/api/test/integration/video-deletion-fixtures.ts apps/api/test/integration/video-deletion.e2e-spec.ts
git commit -m "feat(api): define the asset set owned by a video"
```

---

### Task 5: Library đọc được trạng thái xóa

**Files:**
- Modify: `apps/api/src/modules/library/infrastructure/prisma-library-repository.ts:5,15,27-28,32` (các số dòng là của file gốc; dòng 5 là `include`, 15 là `where`, 27–28 là grant, 32 là `view`)
- Modify: `apps/api/src/modules/library/http/web/library.controller.ts:23`
- Test: `apps/api/test/integration/video-deletion.e2e-spec.ts`

**Interfaces:**
- Consumes: cột `deletion*` và status `DELETING`/`DELETE_FAILED` (Task 2); fixture `seedVideoTree` (Task 4).
- Produces:
  - `GET /v1/videos` bỏ video `DELETING`;
  - `Video.deletion: { requestedAt, errorCode } | null`;
  - `capabilities.canDelete` và `capabilities.deleteBlockedReason`;
  - grant trả `409 VIDEO_DELETING` khi video đang `DELETING`.

- [ ] **Step 1: Viết e2e (fail)**

Thêm vào `video-deletion.e2e-spec.ts`:

- import `createApplication`, `AppConfig` và `NestFastifyApplication` như trong `library.e2e-spec.ts`;
- thêm `let app: NestFastifyApplication;` và một `config: AppConfig` giống hệt `library.e2e-spec.ts`;
- trong `beforeAll`, thêm `app = await createApplication(config);`;
- trong `afterAll`, thêm `await app?.close();` trước khi cleanup;
- thêm block:

```ts
  describe('library reads', () => {
    it('hides DELETING videos from the list but keeps DELETE_FAILED ones visible with their error', async () => {
      const deleting = await seed(); const failed = await seed();
      await prisma.video.update({ where: { id: deleting.ids.video }, data: { status: 'DELETING', deletionRequestedAt: new Date() } });
      await prisma.video.update({ where: { id: failed.ids.video }, data: { status: 'DELETE_FAILED', deletionRequestedAt: new Date(), deletionErrorCode: 'STORAGE_DELETE_FAILED' } });
      const list = await app.inject({ method: 'GET', url: '/v1/videos?limit=100&query=Video sẽ bị xóa' });
      const ids = list.json().data.items.map((item: { id: string }) => item.id);
      expect(ids).not.toContain(deleting.ids.video);
      const failedItem = list.json().data.items.find((item: { id: string }) => item.id === failed.ids.video);
      expect(failedItem.deletion).toMatchObject({ errorCode: 'STORAGE_DELETE_FAILED' });
      expect(failedItem.capabilities).toMatchObject({ canDelete: true, deleteBlockedReason: null });
      const detail = await app.inject({ method: 'GET', url: `/v1/videos/${deleting.ids.video}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.capabilities).toMatchObject({ canDelete: false, deleteBlockedReason: 'DELETING' });
    });

    it('blocks deletion of a published video and refuses grants while deleting', async () => {
      const published = await seed({ withProof: true }); const deleting = await seed();
      const detail = await app.inject({ method: 'GET', url: `/v1/videos/${published.ids.video}` });
      expect(detail.json().data.capabilities).toMatchObject({ canDelete: false, deleteBlockedReason: 'PUBLICATION_HISTORY' });
      expect(detail.json().data.deletion).toBeNull();
      await prisma.video.update({ where: { id: deleting.ids.video }, data: { status: 'DELETING', deletionRequestedAt: new Date() } });
      const grant = await app.inject({ method: 'POST', url: `/v1/videos/${deleting.ids.video}/outputs/${deleting.ids.renderOutput}/video/grant`, payload: { purpose: 'download' } });
      expect(grant.statusCode).toBe(409);
      expect(grant.json().code).toBe('VIDEO_DELETING');
    });
  });
```

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts`
Expected: FAIL (video `DELETING` vẫn có trong list, và `capabilities.canDelete` undefined).

- [ ] **Step 2: Sửa repository**

Trong `prisma-library-repository.ts`:

- `include` (dòng 5): thêm field
  `publishPackages: { select: { tasks: { select: { _count: { select: { proofs: true } } } } } }`.
- `where` (dòng 15): thay `...(filters.includeArchived ? {} : { status: { not: 'ARCHIVED' } })` bằng
  `...(filters.includeArchived ? { status: { not: 'DELETING' } } : { status: { notIn: ['ARCHIVED', 'DELETING'] } })`.
- `assetForGrant` và `outputAssetForGrant`: dòng đầu tiên của mỗi hàm gọi `await this.assertNotDeleting(videoId);`, và thêm method:

```ts
  private async assertNotDeleting(videoId: string) { const video = await this.prisma.video.findUnique({ where: { id: videoId }, select: { status: true } }); if (video?.status === 'DELETING') throw new LibraryError('VIDEO_DELETING', 'Video is being deleted'); }
```

- Trong `view(row)`:
  - trước `return`, thêm
    `const published = row.publishPackages.some((pkg) => pkg.tasks.some((task) => task._count.proofs > 0)); const deleteBlockedReason = row.status === 'DELETING' ? 'DELETING' : published ? 'PUBLICATION_HISTORY' : null;`;
  - sau `archivedAt: …,`, thêm
    `deletion: row.deletionRequestedAt ? { requestedAt: row.deletionRequestedAt.toISOString(), errorCode: row.deletionErrorCode } : null,`;
  - trong `capabilities`, thêm `canDelete: deleteBlockedReason === null, deleteBlockedReason`.

- [ ] **Step 3: Map lỗi trong controller**

Trong `library.controller.ts`, hàm `run`: thay biểu thức status bằng
`error.code === 'VIDEO_NOT_FOUND' ? 404 : ['LIBRARY_ASSET_NOT_AVAILABLE', 'VIDEO_DELETING'].includes(error.code) ? 409 : 400`.

- [ ] **Step 4: Chạy test**

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts test/integration/library.e2e-spec.ts && pnpm --filter @reup-dubbing-studio/api typecheck && pnpm --filter @reup-dubbing-studio/api lint`
Expected: PASS, và library e2e cũ vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/library apps/api/test/integration/video-deletion.e2e-spec.ts
git commit -m "feat(api): expose deletion state in the video library"
```

---

### Task 6: Endpoint yêu cầu xóa (một và nhiều)

**Files:**
- Create: `apps/api/src/modules/video-deletion/infrastructure/prisma-video-deletion-repository.ts` (phần request; phần runner thêm ở Task 8)
- Create: `apps/api/src/modules/video-deletion/application/video-deletion.service.ts`
- Create: `apps/api/src/modules/video-deletion/http/web/video-deletion.controller.ts`, `video-deletion.dto.ts`
- Create: `apps/api/src/modules/video-deletion/video-deletion.module.ts`, `index.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/integration/video-deletion.e2e-spec.ts`

**Interfaces:**
- Consumes: `cancelJobInTransaction`, `ACTIVE_JOB_STATUSES` từ `../../queue` (Task 3); `collectVideoAssetIds`, `markAssetsDeleting`, `DELETION_GRACE_MS`, `VideoDeletionError` (Task 4).
- Produces:
  - `PrismaVideoDeletionRepository(prisma: PrismaClient)`, gồm:
    - `request(videoId, version, key, requestHash, requestId?): Promise<VideoDeletionEnvelope>`, ném `VideoDeletionError`;
    - `requestMany(items: Array<{ videoId: string; version: number }>, key, requestHash, requestId?): Promise<{ items: Array<{ videoId: string; result: BulkDeletionResult; cancelledJobIds: string[] }> }>`;
  - `VideoDeletionService(repository)`, gồm `delete(videoId, version, key, requestId?)` và `deleteMany(items, key, requestId?)`;
  - `VideoDeletionModule.register(config)`.

- [ ] **Step 1: Viết e2e (fail)**

Thêm vào `video-deletion.e2e-spec.ts`. Đặt `import { randomUUID } from 'node:crypto';` ở đầu file.

```ts
  describe('deletion requests', () => {
    const del = (videoId: string, version: number, key = randomUUID()) => app.inject({ method: 'DELETE', url: `/v1/videos/${videoId}`, headers: { 'if-match': `"${version}"`, 'idempotency-key': key } });

    it('accepts, hides the video, marks its assets DELETING and records an audit event', async () => {
      const video = await seed();
      const response = await del(video.ids.video, 1);
      expect(response.statusCode).toBe(202);
      expect(response.json().data).toEqual({ videoId: video.ids.video, status: 'DELETING', cancelledJobIds: [] });
      const row = await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } });
      expect(row).toMatchObject({ status: 'DELETING', version: 2, deletionAttempts: 0 });
      expect(row.deletionGraceUntil!.getTime()).toBeLessThanOrEqual(Date.now());
      const assets = await prisma.asset.findMany({ where: { id: { in: video.videoAssetIds } } });
      expect(assets.every((asset) => asset.status === 'DELETING' && (asset.metadata as { deletion?: { previousStatus?: string } }).deletion?.previousStatus === 'AVAILABLE')).toBe(true);
      expect((await prisma.asset.findUniqueOrThrow({ where: { id: video.asset.voiceSample } })).status).toBe('AVAILABLE');
      expect(await prisma.auditEvent.count({ where: { entityId: video.ids.video, action: 'VIDEO_DELETION_REQUESTED' } })).toBe(1);
    });

    it('cancels an active job so the worker can no longer commit, and sets a grace window', async () => {
      const video = await seed({ jobStatus: 'WAITING_FOR_GPU' });
      const response = await del(video.ids.video, 1);
      expect(response.json().data.cancelledJobIds).toEqual([video.ids.job]);
      expect((await prisma.pipelineJob.findUniqueOrThrow({ where: { id: video.ids.job } })).status).toBe('CANCELLED');
      expect((await prisma.pipelineTask.findUniqueOrThrow({ where: { id: video.ids.task } })).status).toBe('CANCELLED');
      expect((await prisma.taskAttempt.findUniqueOrThrow({ where: { id: video.ids.attempt } })).status).toBe('CANCELLED');
      expect((await prisma.taskLease.findUniqueOrThrow({ where: { id: video.ids.lease } })).releasedAt).not.toBeNull();
      const row = await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } });
      expect(row.deletionGraceUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    });

    it('refuses a video with publication proof and changes nothing', async () => {
      const video = await seed({ withProof: true });
      const response = await del(video.ids.video, 1);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('VIDEO_HAS_PUBLICATION_HISTORY');
      expect((await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } })).status).toBe('READY_TO_PUBLISH');
      expect(await prisma.asset.count({ where: { id: { in: video.videoAssetIds }, status: 'DELETING' } })).toBe(0);
    });

    it('is idempotent, rejects stale versions and reused keys', async () => {
      const video = await seed(); const key = randomUUID();
      const first = await del(video.ids.video, 1, key);
      const replay = await del(video.ids.video, 1, key);
      expect(replay.statusCode).toBe(202);
      expect(replay.json().data).toEqual(first.json().data);
      const again = await del(video.ids.video, 1);
      expect(again.statusCode).toBe(202);
      expect(await prisma.auditEvent.count({ where: { entityId: video.ids.video, action: 'VIDEO_DELETION_REQUESTED' } })).toBe(1);
      const other = await seed();
      expect((await del(other.ids.video, 7)).statusCode).toBe(412);
      expect((await del(other.ids.video, 7)).json().code).toBe('VIDEO_VERSION_CONFLICT');
      const reused = await del(other.ids.video, 1, key);
      expect(reused.statusCode).toBe(409);
      expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await app.inject({ method: 'DELETE', url: `/v1/videos/${other.ids.video}`, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(400);
    });

    it('re-arms a DELETE_FAILED video', async () => {
      const video = await seed();
      await prisma.video.update({ where: { id: video.ids.video }, data: { status: 'DELETE_FAILED', deletionAttempts: 6, deletionErrorCode: 'STORAGE_DELETE_FAILED', deletionRequestedAt: new Date() } });
      const response = await del(video.ids.video, 1);
      expect(response.statusCode).toBe(202);
      expect(await prisma.video.findUniqueOrThrow({ where: { id: video.ids.video } })).toMatchObject({ status: 'DELETING', deletionAttempts: 0, deletionErrorCode: null });
    });

    it('handles a mixed bulk request item by item, in request order', async () => {
      const ok = await seed(); const published = await seed({ withProof: true }); const stale = await seed(); const deleting = await seed();
      await del(deleting.ids.video, 1);
      const missing = '0191f3d2-7f5b-7abc-8b2e-00000000dead';
      const response = await app.inject({ method: 'POST', url: '/v1/videos/deletions', headers: { 'idempotency-key': randomUUID() }, payload: { items: [
        { videoId: ok.ids.video, version: 1 }, { videoId: published.ids.video, version: 1 }, { videoId: stale.ids.video, version: 9 },
        { videoId: missing, version: 1 }, { videoId: deleting.ids.video, version: 1 },
      ] } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.items.map((item: { result: string }) => item.result)).toEqual(['ACCEPTED', 'HAS_PUBLICATION_HISTORY', 'VERSION_CONFLICT', 'NOT_FOUND', 'ALREADY_DELETING']);
      expect((await prisma.video.findUniqueOrThrow({ where: { id: ok.ids.video } })).status).toBe('DELETING');
      expect((await prisma.video.findUniqueOrThrow({ where: { id: stale.ids.video } })).status).toBe('READY_TO_PUBLISH');
      const tooMany = await app.inject({ method: 'POST', url: '/v1/videos/deletions', headers: { 'idempotency-key': randomUUID() }, payload: { items: [] } });
      expect(tooMany.statusCode).toBe(400);
    });
  });
```

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts`
Expected: FAIL (`404 ROUTE_NOT_FOUND` cho `DELETE /v1/videos/:id`).

- [ ] **Step 2: Viết repository (phần request)**

`infrastructure/prisma-video-deletion-repository.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

import { uuidV7 } from '../../../platform/ids/uuid-v7';
import { ACTIVE_JOB_STATUSES, cancelJobInTransaction } from '../../queue';
import { DELETION_GRACE_MS, type BulkDeletionResult, type DeletionOutcome, type VideoDeletionEnvelope } from '../domain/video-deletion';
import { VideoDeletionError } from '../domain/video-deletion-errors';
import { collectVideoAssetIds, markAssetsDeleting } from './video-asset-set';

const OWNER_ID = '01994429-ec00-7000-8000-000000000002';
const SINGLE_SCOPE = 'VIDEO_DELETE_V1';
const BULK_SCOPE = 'VIDEO_BULK_DELETE_V1';
type BulkResult = { items: Array<{ videoId: string; result: BulkDeletionResult; cancelledJobIds: string[] }> };

export class PrismaVideoDeletionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  request(videoId: string, version: number, key: string, requestHash: string, requestId?: string): Promise<VideoDeletionEnvelope> {
    return this.prisma.$transaction(async (tx) => {
      const prior = await replay<VideoDeletionEnvelope>(tx, SINGLE_SCOPE, key, requestHash);
      if (prior) return prior;
      const outcome = await requestInTransaction(tx, videoId, version, requestId);
      if (outcome.result === 'NOT_FOUND') throw new VideoDeletionError('VIDEO_NOT_FOUND', 'Video was not found');
      if (outcome.result === 'VERSION_CONFLICT') throw new VideoDeletionError('VIDEO_VERSION_CONFLICT', 'Video version is stale');
      if (outcome.result === 'HAS_PUBLICATION_HISTORY') throw new VideoDeletionError('VIDEO_HAS_PUBLICATION_HISTORY', 'Video has publication proof and cannot be deleted');
      await remember(tx, SINGLE_SCOPE, key, requestHash, outcome.envelope!);
      return outcome.envelope!;
    }, { isolationLevel: 'Serializable' });
  }

  /** Each item runs in its own transaction so one bad item never rolls back the others. */
  async requestMany(items: Array<{ videoId: string; version: number }>, key: string, requestHash: string, requestId?: string): Promise<BulkResult> {
    const prior = await replay<BulkResult>(this.prisma, BULK_SCOPE, key, requestHash);
    if (prior) return prior;
    const results: BulkResult['items'] = [];
    for (const item of items) {
      const outcome = await this.prisma.$transaction((tx) => requestInTransaction(tx, item.videoId, item.version, requestId), { isolationLevel: 'Serializable' });
      results.push({ videoId: item.videoId, result: outcome.result, cancelledJobIds: outcome.envelope?.cancelledJobIds ?? [] });
    }
    const result = { items: results };
    try { await remember(this.prisma, BULK_SCOPE, key, requestHash, result); } catch (error) { const raced = await replay<BulkResult>(this.prisma, BULK_SCOPE, key, requestHash); if (!raced) throw error; return raced; }
    return result;
  }
}

async function requestInTransaction(tx: Prisma.TransactionClient, videoId: string, version: number, requestId?: string): Promise<DeletionOutcome> {
  const video = await tx.video.findUnique({ where: { id: videoId }, select: { id: true, status: true, version: true, displayTitle: true, sourceKind: true } });
  if (!video) return { result: 'NOT_FOUND', envelope: null };
  if (video.status === 'DELETING') return { result: 'ALREADY_DELETING', envelope: { videoId, status: 'DELETING', cancelledJobIds: [] } };
  if (video.version !== version) return { result: 'VERSION_CONFLICT', envelope: null };
  if (await tx.publicationProof.count({ where: { task: { publishPackage: { videoId } } } })) return { result: 'HAS_PUBLICATION_HISTORY', envelope: null };
  const jobs = await tx.pipelineJob.findMany({ where: { videoId, status: { in: [...ACTIVE_JOB_STATUSES] } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  const cancelledJobIds: string[] = [];
  for (const job of jobs) if (await cancelJobInTransaction(tx, job.id, 'VIDEO_DELETED', requestId)) cancelledJobIds.push(job.id);
  const assetIds = await collectVideoAssetIds(tx, videoId);
  const { pending } = await markAssetsDeleting(tx, assetIds);
  const now = new Date();
  const graceUntil = pending > 0 || cancelledJobIds.length > 0 ? new Date(now.getTime() + DELETION_GRACE_MS) : now;
  await tx.video.update({ where: { id: videoId }, data: { status: 'DELETING', deletionRequestedAt: now, deletionNextAttemptAt: now, deletionGraceUntil: graceUntil, deletionAttempts: 0, deletionErrorCode: null, version: { increment: 1 } } });
  await tx.auditEvent.create({ data: { id: uuidV7(), actorType: 'USER', actorId: OWNER_ID, action: 'VIDEO_DELETION_REQUESTED', entityType: 'VIDEO', entityId: videoId, requestId: requestId ?? null, beforeSafe: { status: video.status, version: video.version }, afterSafe: { status: 'DELETING', version: video.version + 1 }, metadataSafe: { title: video.displayTitle, sourceKind: video.sourceKind, assetCount: assetIds.length, cancelledJobIds } } });
  return { result: 'ACCEPTED', envelope: { videoId, status: 'DELETING', cancelledJobIds } };
}

type IdempotencyStore = Pick<Prisma.TransactionClient, 'idempotencyRecord'>;
async function replay<T>(db: IdempotencyStore, scope: string, key: string, requestHash: string): Promise<T | null> {
  const old = await db.idempotencyRecord.findUnique({ where: { scope_key: { scope, key: digest(key) } } });
  if (!old) return null;
  if (old.requestHash !== requestHash) throw new VideoDeletionError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with another request');
  return old.responseBody as unknown as T;
}
async function remember(db: IdempotencyStore, scope: string, key: string, requestHash: string, body: unknown) {
  await db.idempotencyRecord.create({ data: { id: uuidV7(), scope, key: digest(key), requestHash, responseBody: body as Prisma.InputJsonValue, responseEtag: '"1"' } });
}
function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
```

- [ ] **Step 3: Viết service**

`application/video-deletion.service.ts`:

```ts
import { createHash } from 'node:crypto';

import { VideoDeletionError } from '../domain/video-deletion-errors';
import type { PrismaVideoDeletionRepository } from '../infrastructure/prisma-video-deletion-repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export class VideoDeletionService {
  constructor(private readonly repository: PrismaVideoDeletionRepository) {}
  delete(videoId: string, version: number, key: string, requestId?: string) { const id = uuid(videoId); return this.repository.request(id, version, idempotencyKey(key), hash({ videoId: id, version }), requestId); }
  deleteMany(items: Array<{ videoId: string; version: number }>, key: string, requestId?: string) {
    if (items.length < 1 || items.length > 100) invalid('items must contain 1 to 100 videos');
    if (new Set(items.map((item) => item.videoId)).size !== items.length) invalid('items must not repeat a video');
    const normalized = items.map((item) => ({ videoId: uuid(item.videoId), version: item.version }));
    return this.repository.requestMany(normalized, idempotencyKey(key), hash({ items: normalized }), requestId);
  }
}
function uuid(value: string) { if (!UUID.test(value)) invalid('videoId must be a UUID'); return value.toLowerCase(); }
function idempotencyKey(value: string) { if (!/^[\x21-\x7e]{8,128}$/u.test(value)) invalid('Idempotency-Key must contain 8 to 128 visible ASCII characters'); return value; }
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function invalid(message: string): never { throw new VideoDeletionError('VIDEO_DELETION_VALIDATION_FAILED', message); }
```

- [ ] **Step 4: Viết DTO và controller**

`http/web/video-deletion.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
export class VideoDeletionItemDto { @IsString() videoId!: string; @IsInt() @Min(1) version!: number; }
export class VideoBulkDeletionDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => VideoDeletionItemDto) items!: VideoDeletionItemDto[]; }
```

`http/web/video-deletion.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Delete, Headers, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ProblemDetailsException } from '../../../../platform/http/problem-details.exception';
import { VideoDeletionService } from '../../application/video-deletion.service';
import { VideoDeletionError } from '../../domain/video-deletion-errors';
// Runtime import is required for Nest validation metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VideoBulkDeletionDto } from './video-deletion.dto';

const STATUS: Partial<Record<VideoDeletionError['code'], number>> = { VIDEO_NOT_FOUND: 404, VIDEO_VERSION_CONFLICT: 412, VIDEO_HAS_PUBLICATION_HISTORY: 409, IDEMPOTENCY_KEY_REUSED: 409, VIDEO_DELETION_VALIDATION_FAILED: 400 };

@Controller('v1/videos')
export class VideoDeletionController {
  constructor(@Inject(VideoDeletionService) private readonly deletions: VideoDeletionService) {}
  @Post('deletions') @HttpCode(HttpStatus.OK) deleteMany(@Body() body: VideoBulkDeletionDto, @Headers('idempotency-key') key: string | undefined, @Req() request: FastifyRequest & { requestId?: string }) { return this.run(() => this.deletions.deleteMany(body.items, requiredKey(key), request.requestId)); }
  @Delete(':videoId') @HttpCode(HttpStatus.ACCEPTED) delete(@Param('videoId') videoId: string, @Headers('if-match') match: string | undefined, @Headers('idempotency-key') key: string | undefined, @Req() request: FastifyRequest & { requestId?: string }) { return this.run(() => this.deletions.delete(videoId, version(match), requiredKey(key), request.requestId)); }
  private async run<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch (error) { if (!(error instanceof VideoDeletionError)) throw error; throw new ProblemDetailsException(STATUS[error.code] ?? 500, error.code, error.message); } }
}
function version(value?: string) { const match = /^"([1-9]\d*)"$/u.exec(value ?? ''); if (!match) throw new BadRequestException('If-Match must be a strong numeric ETag'); return Number(match[1]); }
function requiredKey(value?: string) { if (!value) throw new BadRequestException('Idempotency-Key is required'); return value; }
```

- [ ] **Step 5: Viết module và đăng ký**

`video-deletion.module.ts` (runner và object store được thêm ở Task 8):

```ts
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import type { AppConfig } from '../../platform/config/config';
import { PrismaService } from '../../platform/database/prisma.service';
import { VideoDeletionService } from './application/video-deletion.service';
import { VideoDeletionController } from './http/web/video-deletion.controller';
import { PrismaVideoDeletionRepository } from './infrastructure/prisma-video-deletion-repository';

@Module({})
export class VideoDeletionModule { static register(config: Pick<AppConfig, 'databaseUrl'>): DynamicModule { return { module: VideoDeletionModule, controllers: [VideoDeletionController], providers: [{ provide: PrismaService, useFactory: () => new PrismaService(config.databaseUrl) }, { provide: PrismaVideoDeletionRepository, inject: [PrismaService], useFactory: (prisma: PrismaService) => new PrismaVideoDeletionRepository(prisma) }, { provide: VideoDeletionService, inject: [PrismaVideoDeletionRepository], useFactory: (repository: PrismaVideoDeletionRepository) => new VideoDeletionService(repository) }] }; } }
```

`index.ts`: `export { VideoDeletionModule } from './video-deletion.module';`

Trong `app.module.ts`:

- thêm `import { VideoDeletionModule } from './modules/video-deletion';`;
- thêm `VideoDeletionModule.register(config)` ngay sau `LibraryModule.register(config)` trong `imports`.

- [ ] **Step 6: Chạy test**

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts test/integration/library.e2e-spec.ts test/integration/ingest.e2e-spec.ts && pnpm --filter @reup-dubbing-studio/api typecheck && pnpm --filter @reup-dubbing-studio/api lint`
Expected: PASS. `items: []` trả `400 VALIDATION_ERROR` vì validation pipe ném `BadRequestException`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/video-deletion apps/api/src/app.module.ts apps/api/test/integration/video-deletion.e2e-spec.ts
git commit -m "feat(api): request video deletion one by one or in bulk"
```

---

### Task 7: Object store xóa object R2

**Files:**
- Create: `apps/api/src/modules/video-deletion/infrastructure/r2-video-deletion-object-store.ts`
- Test: `apps/api/test/unit/video-deletion-object-store.spec.ts`

**Interfaces:**
- Produces:
  - `interface VideoDeletionObjectStore { deleteObject(bucket: string | null, objectKey: string): Promise<void> }`;
  - `class R2VideoDeletionObjectStore implements VideoDeletionObjectStore`, constructor `(prisma: PrismaClient, cipher: AesGcmCredentialCipher)`;
  - lỗi được ném là `VideoDeletionError` với code `STORAGE_NOT_CONFIGURED`, `STORAGE_BUCKET_MISMATCH` hoặc `STORAGE_DELETE_FAILED`. Object không tồn tại (404/`NoSuchKey`) được coi là thành công.

- [ ] **Step 1: Viết unit test (fail)**

```ts
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AesGcmCredentialCipher } from '../../src/modules/settings';
import { R2VideoDeletionObjectStore } from '../../src/modules/video-deletion/infrastructure/r2-video-deletion-object-store';

describe('R2VideoDeletionObjectStore', () => {
  const cipher = new AesGcmCredentialCipher(Buffer.alloc(32, 8).toString('base64'));
  const encrypted = cipher.encrypt({ accessKeyId: 'id', secretAccessKey: 'secret' });
  const settings = (bucket: string | null = 'bucket') => ({ systemSetting: { findUnique: jest.fn().mockResolvedValue(bucket ? { storageAccountId: 'account', storageBucket: bucket, storageCredential: { encryptedPayload: encrypted.payload, keyVersion: encrypted.keyVersion } } : null) } });
  afterEach(() => jest.restoreAllMocks());

  it('deletes exactly the given bucket and key', async () => {
    const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    await new R2VideoDeletionObjectStore(settings() as never, cipher).deleteObject('bucket', 'videos/v/raw.mp4');
    const command = send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toEqual({ Bucket: 'bucket', Key: 'videos/v/raw.mp4' });
  });

  it('treats a missing object as already deleted', async () => {
    jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }) as never);
    await expect(new R2VideoDeletionObjectStore(settings() as never, cipher).deleteObject('bucket', 'gone')).resolves.toBeUndefined();
  });

  it('maps configuration and storage failures to safe codes', async () => {
    await expect(new R2VideoDeletionObjectStore(settings(null) as never, cipher).deleteObject('bucket', 'k')).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
    await expect(new R2VideoDeletionObjectStore(settings('other') as never, cipher).deleteObject('bucket', 'k')).rejects.toMatchObject({ code: 'STORAGE_BUCKET_MISMATCH' });
    jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(Object.assign(new Error('https://account.r2.cloudflarestorage.com/secret'), { $metadata: { httpStatusCode: 500 } }) as never);
    const failure = new R2VideoDeletionObjectStore(settings() as never, cipher).deleteObject('bucket', 'k');
    await expect(failure).rejects.toMatchObject({ code: 'STORAGE_DELETE_FAILED' });
    await expect(failure).rejects.not.toMatchObject({ message: expect.stringContaining('r2.cloudflarestorage.com') });
  });
});
```

Run: `pnpm --filter @reup-dubbing-studio/api test -- video-deletion-object-store`
Expected: FAIL (module chưa có).

- [ ] **Step 2: Viết store**

```ts
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';

import type { AesGcmCredentialCipher } from '../../settings';
import { VideoDeletionError } from '../domain/video-deletion-errors';

export interface VideoDeletionObjectStore { deleteObject(bucket: string | null, objectKey: string): Promise<void> }

/** The only place that issues DeleteObject for asset files; one exact bucket + key, never a prefix. */
export class R2VideoDeletionObjectStore implements VideoDeletionObjectStore {
  constructor(private readonly prisma: PrismaClient, private readonly cipher: AesGcmCredentialCipher) {}
  async deleteObject(bucket: string | null, objectKey: string): Promise<void> {
    const row = await this.prisma.systemSetting.findUnique({ where: { singletonKey: 'DEFAULT' }, include: { storageCredential: true } });
    if (!row?.storageCredential || !row.storageAccountId || !row.storageBucket) throw new VideoDeletionError('STORAGE_NOT_CONFIGURED', 'Object storage is not configured');
    if (bucket !== row.storageBucket) throw new VideoDeletionError('STORAGE_BUCKET_MISMATCH', 'Asset bucket does not match the configured bucket');
    const credentials = this.cipher.decrypt<{ accessKeyId: string; secretAccessKey: string }>({ payload: row.storageCredential.encryptedPayload, keyVersion: row.storageCredential.keyVersion });
    const client = new S3Client({ region: 'auto', endpoint: `https://${row.storageAccountId}.r2.cloudflarestorage.com`, credentials, forcePathStyle: true });
    try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })); }
    catch (error) { if (isMissing(error)) return; throw new VideoDeletionError('STORAGE_DELETE_FAILED', 'Object storage refused the delete'); }
  }
}
function isMissing(error: unknown) { const value = error as { name?: string; $metadata?: { httpStatusCode?: number } }; return value?.name === 'NoSuchKey' || value?.$metadata?.httpStatusCode === 404; }
```

- [ ] **Step 3: Chạy test**

Run: `pnpm --filter @reup-dubbing-studio/api test -- video-deletion-object-store && pnpm --filter @reup-dubbing-studio/api typecheck && pnpm --filter @reup-dubbing-studio/api lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/video-deletion/infrastructure/r2-video-deletion-object-store.ts apps/api/test/unit/video-deletion-object-store.spec.ts
git commit -m "feat(api): delete one R2 object per asset"
```

---

### Task 8: `VideoDeletionRunner`

**Files:**
- Modify: `apps/api/src/modules/video-deletion/infrastructure/prisma-video-deletion-repository.ts` (thêm các thao tác của runner)
- Create: `apps/api/src/modules/video-deletion/application/video-deletion-runner.ts`
- Modify: `apps/api/src/modules/video-deletion/video-deletion.module.ts`
- Test: `apps/api/test/integration/video-deletion.e2e-spec.ts`

**Interfaces:**
- Consumes: `VideoDeletionObjectStore` (Task 7); `collectVideoAssetIds`, `markAssetsDeleting` (Task 4); `nextDeletionSchedule`, `DELETION_LEASE_MS`, `DELETION_GRACE_MS` (Task 4); `cancelJobInTransaction`, `ACTIVE_JOB_STATUSES` (Task 3).
- Produces:
  - Các method repository:
    - `claimNext(now): Promise<{ id: string; attempts: number; graceUntil: Date | null } | null>`;
    - `assetsToPurge(videoId): Promise<PurgeAsset[]>`;
    - `markAssetDeleted(assetId)`;
    - `scheduleAt(videoId, at)`;
    - `recordFailure(videoId, attemptsBefore, code, now)`;
    - `finalize(videoId, now): Promise<'DELETED' | 'RESCHEDULED' | 'SKIPPED'>`.
  - `class VideoDeletionRunner(repository, objects, enabled = true, clock = () => new Date())`, với `onModuleInit`, `onModuleDestroy` và `tick(): Promise<void>`.

- [ ] **Step 1: Viết e2e (fail)**

Thêm vào `video-deletion.e2e-spec.ts`:

- import `VideoDeletionRunner`, `PrismaVideoDeletionRepository` và `VideoDeletionError`;
- thêm class fake store:

```ts
class FakeObjectStore { deleted: string[] = []; failures = 0; async deleteObject(_bucket: string | null, key: string) { if (this.failures > 0) { this.failures -= 1; throw new VideoDeletionError('STORAGE_DELETE_FAILED', 'boom'); } this.deleted.push(key); } }
```

- thêm block:

```ts
  describe('runner', () => {
    const del = (videoId: string) => app.inject({ method: 'DELETE', url: `/v1/videos/${videoId}`, headers: { 'if-match': '"1"', 'idempotency-key': randomUUID() } });
    const runnerWith = (store: FakeObjectStore) => new VideoDeletionRunner(new PrismaVideoDeletionRepository(prisma), store, false);
    const due = (videoId: string) => prisma.video.update({ where: { id: videoId }, data: { deletionNextAttemptAt: new Date(Date.now() - 1_000) } });
    const tickUntilIdle = async (runner: VideoDeletionRunner) => { for (let i = 0; i < 10; i += 1) await runner.tick(); };

    it('deletes every object and every row of the video, and keeps profile assets', async () => {
      const video = await seed({ sharedWithChannel: true }); const store = new FakeObjectStore();
      await del(video.ids.video);
      await tickUntilIdle(runnerWith(store));
      expect(store.deleted.sort()).toEqual([video.asset.raw, video.asset.transcript, video.asset.audio].map((id) => `videos/${video.ids.video}/${id}`).sort());
      expect(await prisma.video.findUnique({ where: { id: video.ids.video } })).toBeNull();
      expect(await prisma.pipelineJob.count({ where: { videoId: video.ids.video } })).toBe(0);
      expect(await prisma.taskAttempt.count({ where: { id: video.ids.attempt } })).toBe(0);
      expect(await prisma.publishPackage.count({ where: { videoId: video.ids.video } })).toBe(0);
      expect(await prisma.asset.count({ where: { id: { in: [video.asset.raw, video.asset.transcript, video.asset.audio] } } })).toBe(0);
      const kept = await prisma.asset.findMany({ where: { id: { in: [video.asset.output, video.asset.voiceSample, video.asset.channelAsset] } } });
      expect(kept.map((asset) => [asset.status, asset.createdByAttemptId])).toEqual([['AVAILABLE', null], ['AVAILABLE', null], ['AVAILABLE', null]]);
      expect(await prisma.auditEvent.count({ where: { entityId: video.ids.video, action: 'VIDEO_DELETED' } })).toBe(1);
      expect((await app.inject({ method: 'GET', url: `/v1/videos/${video.ids.video}` })).statusCode).toBe(404);
    });

    it('waits for the grace window before removing a video with late PENDING uploads', async () => {
      const video = await seed({ jobStatus: 'RUNNING', pendingOutput: true }); const store = new FakeObjectStore(); const runner = runnerWith(store);
      await del(video.ids.video);
      await runner.tick();
      expect(await prisma.video.findUnique({ where: { id: video.ids.video } })).not.toBeNull();
      expect(store.deleted).not.toContain(`videos/${video.ids.video}/${video.asset.pending}`);
      await prisma.video.update({ where: { id: video.ids.video }, data: { deletionGraceUntil: new Date(Date.now() - 1_000) } });
      await due(video.ids.video);
      await tickUntilIdle(runner);
      expect(store.deleted).toContain(`videos/${video.ids.video}/${video.asset.pending}`);
      expect(await prisma.video.findUnique({ where: { id: video.ids.video } })).toBeNull();
    });

    it('retries storage failures with backoff and fails for good after six attempts', async () => {
      const flaky = await seed(); const store = new FakeObjectStore(); const runner = runnerWith(store);
      await del(flaky.ids.video);
      store.failures = 3;
      for (let i = 0; i < 3; i += 1) { await runner.tick(); await due(flaky.ids.video); }
      expect((await prisma.video.findUniqueOrThrow({ where: { id: flaky.ids.video } })).deletionAttempts).toBe(3);
      await tickUntilIdle(runner);
      expect(await prisma.video.findUnique({ where: { id: flaky.ids.video } })).toBeNull();

      const broken = await seed(); store.failures = 6;
      await del(broken.ids.video);
      for (let i = 0; i < 6; i += 1) { await runner.tick(); await prisma.video.updateMany({ where: { id: broken.ids.video, status: 'DELETING' }, data: { deletionNextAttemptAt: new Date(Date.now() - 1_000) } }); }
      const failed = await prisma.video.findUniqueOrThrow({ where: { id: broken.ids.video } });
      expect(failed).toMatchObject({ status: 'DELETE_FAILED', deletionAttempts: 6, deletionErrorCode: 'STORAGE_DELETE_FAILED' });
      const retry = await app.inject({ method: 'DELETE', url: `/v1/videos/${broken.ids.video}`, headers: { 'if-match': `"${failed.version}"`, 'idempotency-key': randomUUID() } });
      expect(retry.statusCode).toBe(202);
      await tickUntilIdle(runner);
      expect(await prisma.video.findUnique({ where: { id: broken.ids.video } })).toBeNull();
    });
  });
```

Ghi chú về kịch bản 6 (asset dùng chung): `sharedWithChannel` link `asset.output` vào `ChannelProfileAsset`, nên object của `output` không bị xóa, dòng còn nguyên, còn `createdByAttemptId` được gỡ về `null`. Vì `cleanupVideoTree` vẫn chạy ở `afterAll`, các phần còn lại được dọn.

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts`
Expected: FAIL (không import được `VideoDeletionRunner`).

- [ ] **Step 2: Thêm các thao tác runner vào repository**

Thêm vào `PrismaVideoDeletionRepository`:

- import `DELETION_LEASE_MS`, `nextDeletionSchedule`;
- thêm type `export type PurgeAsset = { id: string; storageBackend: string; bucket: string | null; objectKey: string; previousStatus: string };`;
- thêm các method:

```ts
  /** Claims one due DELETING video and pushes its next attempt out by the soft lease. */
  async claimNext(now: Date): Promise<{ id: string; attempts: number; graceUntil: Date | null } | null> {
    const lease = new Date(now.getTime() + DELETION_LEASE_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; attempts: number; graceUntil: Date | null }>>`
      UPDATE "videos" SET "deletion_next_attempt_at" = ${lease}
      WHERE "id" = (SELECT "id" FROM "videos" WHERE "status" = 'DELETING' AND "deletion_next_attempt_at" <= ${now} ORDER BY "deletion_requested_at" ASC, "id" ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING "id", "deletion_attempts" AS "attempts", "deletion_grace_until" AS "graceUntil"`;
    return rows[0] ?? null;
  }

  async assetsToPurge(videoId: string): Promise<PurgeAsset[]> {
    const ids = await this.prisma.$transaction((tx) => collectVideoAssetIds(tx, videoId));
    const rows = await this.prisma.asset.findMany({ where: { id: { in: ids }, status: 'DELETING' }, select: { id: true, storageBackend: true, bucket: true, objectKey: true, metadata: true }, orderBy: { id: 'asc' } });
    return rows.map((row) => ({ id: row.id, storageBackend: row.storageBackend, bucket: row.bucket, objectKey: row.objectKey, previousStatus: previousStatus(row.metadata) }));
  }

  async markAssetDeleted(assetId: string) { await this.prisma.asset.updateMany({ where: { id: assetId, status: 'DELETING' }, data: { status: 'DELETED', deletedAt: new Date(), version: { increment: 1 } } }); }

  async scheduleAt(videoId: string, at: Date) { await this.prisma.video.updateMany({ where: { id: videoId, status: 'DELETING' }, data: { deletionNextAttemptAt: at } }); }

  async recordFailure(videoId: string, attemptsBefore: number, code: string, now: Date) {
    const attempts = attemptsBefore + 1; const schedule = nextDeletionSchedule(attempts, now);
    await this.prisma.video.updateMany({ where: { id: videoId, status: 'DELETING' }, data: { deletionAttempts: attempts, deletionErrorCode: code, deletionNextAttemptAt: schedule.nextAttemptAt, status: schedule.status, ...(schedule.status === 'DELETE_FAILED' ? { version: { increment: 1 } } : {}) } });
  }

  /** Removes the rows once every owned object is gone; reschedules if new jobs or files appeared meanwhile. */
  finalize(videoId: string, now: Date): Promise<'DELETED' | 'RESCHEDULED' | 'SKIPPED'> {
    return this.prisma.$transaction(async (tx) => {
      const video = await tx.video.findUnique({ where: { id: videoId }, select: { status: true, displayTitle: true } });
      if (video?.status !== 'DELETING') return 'SKIPPED';
      const active = await tx.pipelineJob.findMany({ where: { videoId, status: { in: [...ACTIVE_JOB_STATUSES] } }, select: { id: true } });
      for (const job of active) await cancelJobInTransaction(tx, job.id, 'VIDEO_DELETED');
      const assetIds = await collectVideoAssetIds(tx, videoId);
      const stragglers = await tx.asset.findMany({ where: { id: { in: assetIds }, status: { not: 'DELETED' } }, select: { id: true, status: true } });
      if (active.length || stragglers.length) {
        await markAssetsDeleting(tx, stragglers.map((row) => row.id));
        const grace = active.length || stragglers.some((row) => row.status === 'PENDING') ? new Date(now.getTime() + DELETION_GRACE_MS) : now;
        await tx.video.update({ where: { id: videoId }, data: { deletionGraceUntil: grace, deletionNextAttemptAt: now } });
        return 'RESCHEDULED';
      }
      if (await tx.publicationProof.count({ where: { task: { publishPackage: { videoId } } } })) throw new VideoDeletionError('VIDEO_HAS_PUBLICATION_HISTORY', 'Video gained publication proof');
      const stats = await tx.asset.aggregate({ where: { id: { in: assetIds } }, _count: { _all: true }, _sum: { byteSize: true } });
      await deleteVideoRows(tx, videoId, assetIds);
      await tx.auditEvent.create({ data: { id: uuidV7(), actorType: 'SYSTEM', action: 'VIDEO_DELETED', entityType: 'VIDEO', entityId: videoId, metadataSafe: { title: video.displayTitle, objectCount: stats._count._all, byteSize: (stats._sum.byteSize ?? 0n).toString() } } });
      return 'DELETED';
    }, { isolationLevel: 'Serializable', timeout: 30_000 });
  }
```

- thêm các hàm module-level:

```ts
/** Deletes the video tree in foreign-key order (all FKs are RESTRICT). */
async function deleteVideoRows(tx: Prisma.TransactionClient, videoId: string, assetIds: string[]) {
  const jobIds = (await tx.pipelineJob.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const taskIds = (await tx.pipelineTask.findMany({ where: { pipelineJobId: { in: jobIds } }, select: { id: true } })).map((row) => row.id);
  const attemptIds = (await tx.taskAttempt.findMany({ where: { pipelineTaskId: { in: taskIds } }, select: { id: true } })).map((row) => row.id);
  const segmentIds = (await tx.videoSegment.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const runIds = (await tx.transcriptRun.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const packageIds = (await tx.publishPackage.findMany({ where: { videoId }, select: { id: true } })).map((row) => row.id);
  const publicationTaskIds = (await tx.publicationTask.findMany({ where: { publishPackageId: { in: packageIds } }, select: { id: true } })).map((row) => row.id);
  const fieldIds = (await tx.publicationField.findMany({ where: { publicationTaskId: { in: publicationTaskIds } }, select: { id: true } })).map((row) => row.id);
  await tx.publicationField.updateMany({ where: { id: { in: fieldIds } }, data: { currentRevisionId: null } });
  await tx.publicationFieldRevision.deleteMany({ where: { publicationFieldId: { in: fieldIds } } });
  await tx.publicationField.deleteMany({ where: { id: { in: fieldIds } } });
  await tx.publicationChecklistItem.deleteMany({ where: { publicationTaskId: { in: publicationTaskIds } } });
  await tx.publicationTask.deleteMany({ where: { id: { in: publicationTaskIds } } });
  await tx.publishPackage.deleteMany({ where: { id: { in: packageIds } } });
  await tx.renderOutput.deleteMany({ where: { videoId } });
  await tx.reviewDecision.deleteMany({ where: { videoId } });
  await tx.segmentAudioRevision.deleteMany({ where: { videoSegmentId: { in: segmentIds } } });
  await tx.videoSegment.updateMany({ where: { videoId }, data: { currentRevisionId: null } });
  await tx.segmentRevision.deleteMany({ where: { videoSegmentId: { in: segmentIds } } });
  await tx.videoSegment.deleteMany({ where: { videoId } });
  await tx.transcriptSegment.deleteMany({ where: { transcriptRunId: { in: runIds } } });
  await tx.transcriptRun.deleteMany({ where: { videoId } });
  await tx.videoAsset.deleteMany({ where: { videoId } });
  await tx.workflowEvent.deleteMany({ where: { OR: [{ videoId }, { pipelineJobId: { in: jobIds } }, { pipelineTaskId: { in: taskIds } }, { taskAttemptId: { in: attemptIds } }] } });
  await tx.taskLease.deleteMany({ where: { pipelineTaskId: { in: taskIds } } });
  await tx.asset.updateMany({ where: { createdByAttemptId: { in: attemptIds }, id: { notIn: assetIds } }, data: { createdByAttemptId: null } });
  await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
  await tx.taskAttempt.deleteMany({ where: { id: { in: attemptIds } } });
  await tx.pipelineTaskDependency.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] } });
  await tx.pipelineTask.deleteMany({ where: { id: { in: taskIds } } });
  await tx.pipelineJob.deleteMany({ where: { id: { in: jobIds } } });
  await tx.video.delete({ where: { id: videoId } });
}
function previousStatus(metadata: Prisma.JsonValue) { const deletion = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, Prisma.JsonValue>).deletion : null; const value = deletion && typeof deletion === 'object' && !Array.isArray(deletion) ? (deletion as Record<string, Prisma.JsonValue>).previousStatus : null; return typeof value === 'string' ? value : 'AVAILABLE'; }
```

- [ ] **Step 3: Viết runner**

`application/video-deletion-runner.ts`:

```ts
import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { VideoDeletionError } from '../domain/video-deletion-errors';
import type { PrismaVideoDeletionRepository, PurgeAsset } from '../infrastructure/prisma-video-deletion-repository';
import type { VideoDeletionObjectStore } from '../infrastructure/r2-video-deletion-object-store';

const POLL_MS = 2_000;

/** Removes DELETING videos in the background: objects first (one exact key each), then the DB rows. */
export class VideoDeletionRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoDeletionRunner.name);
  private timer?: NodeJS.Timeout;
  private active = false;
  private stopping = false;

  constructor(
    private readonly repository: PrismaVideoDeletionRepository,
    private readonly objects: VideoDeletionObjectStore,
    private readonly enabled = true,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.active) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /** Processes at most one video. */
  async tick(): Promise<void> {
    if (this.active || this.stopping) return;
    this.active = true;
    try {
      const claimed = await this.repository.claimNext(this.clock());
      if (!claimed) return;
      try { await this.process(claimed); }
      catch (error) {
        const code = error instanceof VideoDeletionError ? error.code : 'DELETION_FAILED';
        this.logger.warn(`Video deletion attempt failed videoId=${claimed.id} code=${code}`);
        await this.repository.recordFailure(claimed.id, claimed.attempts, code, this.clock());
      }
    } finally { this.active = false; }
  }

  private async process(claimed: { id: string; graceUntil: Date | null }) {
    const assets = await this.repository.assetsToPurge(claimed.id);
    for (const asset of assets.filter((item) => item.previousStatus !== 'PENDING')) await this.purge(asset);
    if (claimed.graceUntil && this.clock() < claimed.graceUntil) { await this.repository.scheduleAt(claimed.id, claimed.graceUntil); return; }
    for (const asset of assets.filter((item) => item.previousStatus === 'PENDING')) await this.purge(asset);
    const outcome = await this.repository.finalize(claimed.id, this.clock());
    if (outcome === 'DELETED') this.logger.log(`Video deleted videoId=${claimed.id}`);
  }

  private async purge(asset: PurgeAsset) {
    if (asset.storageBackend === 'R2') await this.objects.deleteObject(asset.bucket, asset.objectKey);
    await this.repository.markAssetDeleted(asset.id);
  }
}
```

- [ ] **Step 4: Wiring module**

Trong `video-deletion.module.ts`:

- `register(config: Pick<AppConfig, 'databaseUrl' | 'settingsEncryptionKey' | 'nodeEnv'>)`;
- thêm provider `AesGcmCredentialCipher` (import từ `'../settings'`), giống `LibraryModule`;
- thêm provider `R2VideoDeletionObjectStore`, `inject: [PrismaService, AesGcmCredentialCipher]`;
- thêm provider:

```ts
{ provide: VideoDeletionRunner, inject: [PrismaVideoDeletionRepository, R2VideoDeletionObjectStore], useFactory: (repository: PrismaVideoDeletionRepository, objects: R2VideoDeletionObjectStore) => new VideoDeletionRunner(repository, objects, config.nodeEnv !== 'test') }
```

- [ ] **Step 5: Chạy test**

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e -- test/integration/video-deletion.e2e-spec.ts && pnpm --filter @reup-dubbing-studio/api test && pnpm --filter @reup-dubbing-studio/api typecheck && pnpm --filter @reup-dubbing-studio/api lint`
Expected: PASS. Nếu `finalize` báo lỗi khóa ngoại, đọc tên constraint trong message, rồi dời câu `deleteMany` của bảng con lên trước. Không thêm cascade.

- [ ] **Step 6: Chạy toàn bộ e2e API (regression)**

Run: `pnpm --filter @reup-dubbing-studio/api test:e2e`
Expected: mọi suite PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/video-deletion apps/api/test/integration/video-deletion.e2e-spec.ts
git commit -m "feat(api): purge deleted videos in the background"
```

---

### Task 9: Web — API client và model kết quả xóa

**Files:**
- Modify: `apps/web/src/features/library/api/library-api.ts`
- Create: `apps/web/src/features/library/model/video-deletion.ts`
- Test: `apps/web/src/features/library/model/video-deletion.test.ts`, `apps/web/src/features/library/api/library-api.test.ts`

**Interfaces:**
- Consumes: `deleteVideo` và `deleteVideos` từ `@reup-dubbing-studio/api-client` (Task 1).
- Produces:
  - `LibraryVideo` có `deletion: { requestedAt: string; errorCode: string | null } | null`, `capabilities.canDelete`, `capabilities.deleteBlockedReason`, `latestJob: { id: string; status: string } | null` (schema passthrough);
  - `deleteLibraryVideo(video: { id: string; version: number }, idempotencyKey: string): Promise<{ videoId: string; status: 'DELETING' | 'DELETE_FAILED'; cancelledJobIds: string[] }>`;
  - `deleteLibraryVideos(items: Array<{ videoId: string; version: number }>, idempotencyKey: string): Promise<Array<{ videoId: string; result: BulkResult; cancelledJobIds: string[] }>>`;
  - `hasActiveJob(video: LibraryVideo): boolean`;
  - `summarizeBulkDeletion(items): { tone: 'success' | 'warning'; message: string }`.

- [ ] **Step 1: Viết test model (fail)**

`features/library/model/video-deletion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { libraryVideo } from '@/test/fixtures/control-plane';
import { hasActiveJob, summarizeBulkDeletion } from './video-deletion';

const item = (result: 'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND') => ({ videoId: libraryVideo.id, result, cancelledJobIds: [] });

describe('video deletion model', () => {
  it('groups bulk results into one readable message', () => {
    expect(summarizeBulkDeletion([item('ACCEPTED'), item('ACCEPTED'), item('ALREADY_DELETING')])).toEqual({ tone: 'success', message: 'Đã xóa 3 video. File sẽ được dọn trong nền.' });
    expect(summarizeBulkDeletion([item('ACCEPTED'), item('NOT_FOUND'), item('HAS_PUBLICATION_HISTORY'), item('VERSION_CONFLICT')])).toEqual({ tone: 'warning', message: 'Đã xóa 2 video. 1 video có lịch sử đăng bài nên được giữ lại. 1 video vừa thay đổi, tải lại rồi thử lại.' });
    expect(summarizeBulkDeletion([item('HAS_PUBLICATION_HISTORY')])).toEqual({ tone: 'warning', message: '1 video có lịch sử đăng bài nên được giữ lại.' });
  });

  it('detects a job that deletion would cancel', () => {
    expect(hasActiveJob({ ...libraryVideo, latestJob: null })).toBe(false);
    expect(hasActiveJob({ ...libraryVideo, latestJob: { id: libraryVideo.id, status: 'WAITING_FOR_GPU' } })).toBe(true);
    expect(hasActiveJob({ ...libraryVideo, latestJob: { id: libraryVideo.id, status: 'SUCCEEDED' } })).toBe(false);
  });
});
```

Run: `VITE_CONTROL_PLANE_URL=http://localhost:3000/v1 pnpm web:test -- features/library/model`
Expected: FAIL (không import được `./video-deletion`).

- [ ] **Step 2: Viết model**

`features/library/model/video-deletion.ts`:

```ts
import type { LibraryVideo } from '../api/library-api';

export type BulkResult = 'ACCEPTED' | 'ALREADY_DELETING' | 'HAS_PUBLICATION_HISTORY' | 'VERSION_CONFLICT' | 'NOT_FOUND';
const ACTIVE = new Set(['QUEUED', 'RUNNING', 'WAITING_FOR_GPU', 'WAITING_FOR_REVIEW']);

export function hasActiveJob(video: LibraryVideo): boolean { return Boolean(video.latestJob && ACTIVE.has(video.latestJob.status)); }

/** NOT_FOUND means the video is already gone, which is what the operator asked for. */
export function summarizeBulkDeletion(items: Array<{ result: BulkResult }>): { tone: 'success' | 'warning'; message: string } {
  const count = (...results: BulkResult[]) => items.filter((item) => results.includes(item.result)).length;
  const deleted = count('ACCEPTED', 'ALREADY_DELETING', 'NOT_FOUND'); const published = count('HAS_PUBLICATION_HISTORY'); const stale = count('VERSION_CONFLICT');
  const parts = [
    deleted ? `Đã xóa ${deleted} video.${published || stale ? '' : ' File sẽ được dọn trong nền.'}` : null,
    published ? `${published} video có lịch sử đăng bài nên được giữ lại.` : null,
    stale ? `${stale} video vừa thay đổi, tải lại rồi thử lại.` : null,
  ].filter(Boolean);
  return { tone: published || stale ? 'warning' : 'success', message: parts.join(' ') };
}
```

- [ ] **Step 3: Mở rộng `library-api.ts`**

- Import thêm `deleteVideo` và `deleteVideos`.
- Trong schema `video`:
  - thay `latestJob: z.unknown().nullable()` bằng `latestJob: z.object({ id: uuid, status: z.string() }).passthrough().nullable()`;
  - thêm `deletion: z.object({ requestedAt: z.string().datetime(), errorCode: z.string().nullable() }).nullable()`;
  - thay object `capabilities` bằng
    `z.object({ canOpenStudio: z.boolean(), canOpenPublishing: z.boolean(), canArchive: z.boolean(), canDelete: z.boolean(), deleteBlockedReason: z.enum(['PUBLICATION_HISTORY', 'DELETING']).nullable() })`.
- Thêm vào cuối file (trước `export type { VideoOutput };`):

```ts
const deletionResult = z.object({ videoId: uuid, status: z.enum(['DELETING', 'DELETE_FAILED']), cancelledJobIds: z.array(uuid) });
const bulkResult = z.object({ items: z.array(z.object({ videoId: uuid, result: z.enum(['ACCEPTED', 'ALREADY_DELETING', 'HAS_PUBLICATION_HISTORY', 'VERSION_CONFLICT', 'NOT_FOUND']), cancelledJobIds: z.array(uuid) })) });
/** Asks the Control Plane to delete a video; objects are removed in the background. */
export async function deleteLibraryVideo(target: { id: string; version: number }, idempotencyKey: string) {
  const result = await deleteVideo({ client: client(), path: { videoId: target.id }, headers: { 'If-Match': `"${target.version}"`, 'Idempotency-Key': idempotencyKey } });
  if (result.error) throw parseError(result.error, result.response, 'Không thể xóa video.');
  const parsed = envelope(deletionResult).safeParse(result.data);
  if (!parsed.success) throw new LibraryApiError('Control Plane trả về kết quả xóa không hợp lệ.');
  return parsed.data.data;
}
export async function deleteLibraryVideos(items: Array<{ videoId: string; version: number }>, idempotencyKey: string) {
  const result = await deleteVideos({ client: client(), headers: { 'Idempotency-Key': idempotencyKey }, body: { items } });
  if (result.error) throw parseError(result.error, result.response, 'Không thể xóa các video đã chọn.');
  const parsed = envelope(bulkResult).safeParse(result.data);
  if (!parsed.success) throw new LibraryApiError('Control Plane trả về kết quả xóa không hợp lệ.');
  return parsed.data.data.items;
}
```

- Đổi `parseError(value, response)` thành `parseError(value: unknown, response: Response, fallback = 'Không thể tải thư viện video.')`, và dùng `fallback` thay cho chuỗi cố định.

- [ ] **Step 4: Viết test API (MSW)**

`features/library/api/library-api.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, libraryVideo } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { deleteLibraryVideo, deleteLibraryVideos, LibraryApiError } from './library-api';

const meta = { requestId: READY_REQUEST_ID };
describe('library deletion API', () => {
  it('sends the version as a strong ETag with an idempotency key', async () => {
    let headers: Headers | null = null;
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, ({ request }) => { headers = request.headers; return HttpResponse.json({ data: { videoId: libraryVideo.id, status: 'DELETING', cancelledJobIds: [] }, meta }, { status: 202 }); }));
    await expect(deleteLibraryVideo(libraryVideo, 'delete-key-1')).resolves.toMatchObject({ status: 'DELETING' });
    expect(headers!.get('If-Match')).toBe('"4"');
    expect(headers!.get('Idempotency-Key')).toBe('delete-key-1');
  });

  it('surfaces the problem code when deletion is refused', async () => {
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Video has publication proof', code: 'VIDEO_HAS_PUBLICATION_HISTORY', requestId: READY_REQUEST_ID }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } })));
    await expect(deleteLibraryVideo(libraryVideo, 'delete-key-2')).rejects.toMatchObject({ code: 'VIDEO_HAS_PUBLICATION_HISTORY' } satisfies Partial<LibraryApiError>);
  });

  it('returns bulk results in request order', async () => {
    server.use(http.post(`${CONTROL_PLANE_BASE_URL}/videos/deletions`, async ({ request }) => { const body = await request.json() as { items: Array<{ videoId: string }> }; return HttpResponse.json({ data: { items: body.items.map((item) => ({ videoId: item.videoId, result: 'ACCEPTED', cancelledJobIds: [] })) }, meta }); }));
    await expect(deleteLibraryVideos([{ videoId: libraryVideo.id, version: 4 }], 'bulk-key-1')).resolves.toEqual([{ videoId: libraryVideo.id, result: 'ACCEPTED', cancelledJobIds: [] }]);
  });
});
```

Nếu `createProblemDetails` trong fixture tạo đúng problem body, dùng nó thay cho object viết tay.

- [ ] **Step 5: Chạy test**

Run: `VITE_CONTROL_PLANE_URL=http://localhost:3000/v1 pnpm web:test && pnpm --filter @reup-dubbing-studio/web typecheck && pnpm --filter @reup-dubbing-studio/web lint`
Expected: PASS (toàn suite), không có act() warning.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/library
git commit -m "feat(web): library deletion API and result summary"
```

---

### Task 10: Web — nút "Xóa video" ở trang Chi tiết

**Files:**
- Create: `apps/web/src/features/library/ui/delete-video-button.tsx`
- Modify: `apps/web/src/routes/library/detail-page.tsx`
- Test: `apps/web/src/features/library/ui/delete-video-button.test.tsx`

**Interfaces:**
- Consumes: `deleteLibraryVideo`, `LibraryApiError`, `LibraryVideo` (Task 9); `hasActiveJob` (Task 9); `libraryKeys` (`library-query.ts`).
- Produces: `DeleteVideoButton({ video }: { video: LibraryVideo })`.

- [ ] **Step 1: Viết test (fail)**

`features/library/ui/delete-video-button.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, libraryVideo } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { DeleteVideoButton } from './delete-video-button';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
const renderAt = (video = libraryVideo) => renderApp(<Routes><Route path="/library/:videoId" element={<DeleteVideoButton video={video} />} /><Route path="/library" element={<p>Trang thư viện</p>} /></Routes>, { route: `/library/${video.id}` });

describe('DeleteVideoButton', () => {
  beforeEach(() => { toast.success.mockReset(); toast.error.mockReset(); });

  it('confirms, deletes with the current version and returns to the library', async () => {
    const user = userEvent.setup(); let ifMatch: string | null = null;
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, ({ request }) => { ifMatch = request.headers.get('If-Match'); return HttpResponse.json({ data: { videoId: libraryVideo.id, status: 'DELETING', cancelledJobIds: [] }, meta: { requestId: READY_REQUEST_ID } }, { status: 202 }); }));
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Xóa video' }));
    expect(screen.getByRole('alertdialog', { name: 'Xóa video này?' })).toBeInTheDocument();
    expect(screen.getByText('Xóa vĩnh viễn video gốc, audio, video kết quả, SRT và transcript. Không thể khôi phục.')).toBeInTheDocument();
    expect(screen.queryByText('Job đang chạy sẽ bị hủy.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    expect(await screen.findByText('Trang thư viện')).toBeInTheDocument();
    expect(ifMatch).toBe('"4"');
    expect(toast.success).toHaveBeenCalledWith('Đã xóa video. File sẽ được dọn trong nền.');
  });

  it('warns that the running job will be cancelled', async () => {
    const user = userEvent.setup();
    renderAt({ ...libraryVideo, latestJob: { id: libraryVideo.id, status: 'RUNNING' } });
    await user.click(screen.getByRole('button', { name: 'Xóa video' }));
    expect(screen.getByText('Job đang chạy sẽ bị hủy.')).toBeInTheDocument();
  });

  it('locks the button for a video with publication proof', async () => {
    const user = userEvent.setup();
    renderAt({ ...libraryVideo, capabilities: { ...libraryVideo.capabilities, canDelete: false, deleteBlockedReason: 'PUBLICATION_HISTORY' } });
    const button = screen.getByRole('button', { name: 'Xóa video' });
    expect(button).toBeDisabled();
    await user.hover(button.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Video đã có bằng chứng đăng bài nên không thể xóa.');
  });

  it('hides the button while the video is being deleted', () => {
    renderAt({ ...libraryVideo, status: 'DELETING', capabilities: { ...libraryVideo.capabilities, canDelete: false, deleteBlockedReason: 'DELETING' } });
    expect(screen.queryByRole('button', { name: 'Xóa video' })).not.toBeInTheDocument();
  });

  it('shows the server message and stays on the page when deletion is refused', async () => {
    const user = userEvent.setup();
    server.use(http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, () => HttpResponse.json({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'Video đã có bằng chứng đăng bài.', code: 'VIDEO_HAS_PUBLICATION_HISTORY', requestId: READY_REQUEST_ID }, { status: 409, headers: { 'Content-Type': 'application/problem+json' } })));
    renderAt();
    await user.click(screen.getByRole('button', { name: 'Xóa video' }));
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Video đã có bằng chứng đăng bài.'));
    expect(screen.queryByText('Trang thư viện')).not.toBeInTheDocument();
  });
});
```

Run: `VITE_CONTROL_PLANE_URL=http://localhost:3000/v1 pnpm web:test -- delete-video-button`
Expected: FAIL (không import được component).

- [ ] **Step 2: Viết component**

`features/library/ui/delete-video-button.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { deleteLibraryVideo, LibraryApiError, type LibraryVideo } from '../api/library-api';
import { libraryKeys } from '../api/library-query';
import { hasActiveJob } from '../model/video-deletion';

export function DeleteVideoButton({ video }: { video: LibraryVideo }) {
  const [open, setOpen] = useState(false); const keys = useRef(new Map<string, string>());
  const client = useQueryClient(); const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => { const mapKey = `${video.id}:${video.version}`; const key = keys.current.get(mapKey) ?? crypto.randomUUID(); keys.current.set(mapKey, key); return deleteLibraryVideo(video, key); },
    onSuccess: async () => { setOpen(false); client.removeQueries({ queryKey: libraryKeys.detail(video.id) }); await client.invalidateQueries({ queryKey: libraryKeys.lists() }); toast.success('Đã xóa video. File sẽ được dọn trong nền.'); navigate('/library'); },
    onError: async (error) => { if (error instanceof LibraryApiError && error.code === 'VIDEO_VERSION_CONFLICT') await client.invalidateQueries({ queryKey: libraryKeys.detail(video.id) }); toast.error(error instanceof LibraryApiError ? error.message : 'Không thể xóa video.'); },
  });
  if (video.capabilities.deleteBlockedReason === 'DELETING') return null;
  if (video.capabilities.deleteBlockedReason === 'PUBLICATION_HISTORY') return <Tooltip><TooltipTrigger asChild><span tabIndex={0}><Button variant="destructive" disabled><Trash2Icon />Xóa video</Button></span></TooltipTrigger><TooltipContent>Video đã có bằng chứng đăng bài nên không thể xóa.</TooltipContent></Tooltip>;
  return <>
    <Button variant="destructive" onClick={() => setOpen(true)}><Trash2Icon />Xóa video</Button>
    <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xóa video này?</AlertDialogTitle><AlertDialogDescription>Xóa vĩnh viễn video gốc, audio, video kết quả, SRT và transcript. Không thể khôi phục.</AlertDialogDescription>{hasActiveJob(video) && <AlertDialogDescription>Job đang chạy sẽ bị hủy.</AlertDialogDescription>}</AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Quay lại</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); remove.mutate(); }}>Xóa vĩnh viễn</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
```

- [ ] **Step 3: Gắn vào trang Chi tiết**

Trong `routes/library/detail-page.tsx`:

- import `DeleteVideoButton`;
- trong header, thay `<Button asChild variant="outline"><Link to="/library">Quay lại</Link></Button>` bằng
  `<div className="heading-actions"><DeleteVideoButton video={video} /><Button asChild variant="outline"><Link to="/library">Quay lại</Link></Button></div>`;
- thay `<Badge variant="outline">{video.status}</Badge>` bằng
  `<Badge variant="outline">{video.status === 'DELETING' ? 'Đang xóa' : video.status === 'DELETE_FAILED' ? 'Xóa thất bại' : video.status}</Badge>`.

- [ ] **Step 4: Chạy test**

Run: `VITE_CONTROL_PLANE_URL=http://localhost:3000/v1 pnpm web:test && pnpm --filter @reup-dubbing-studio/web typecheck && pnpm --filter @reup-dubbing-studio/web lint`
Expected: PASS, không có act() warning. Nếu tooltip không hiện trong jsdom khi hover `span`, dùng `await user.tab()` để focus `span` (có `tabIndex={0}`), rồi assert `findByRole('tooltip')`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/library/ui/delete-video-button.tsx apps/web/src/features/library/ui/delete-video-button.test.tsx apps/web/src/routes/library/detail-page.tsx
git commit -m "feat(web): delete a video from its detail page"
```

---

### Task 11: Web — chọn nhiều và xóa ở Thư viện

**Files:**
- Create: `apps/web/src/features/library/ui/library-bulk-delete.tsx`
- Modify: `apps/web/src/routes/library/page.tsx`
- Test: `apps/web/src/routes/library/page.test.tsx`

**Interfaces:**
- Consumes: `deleteLibraryVideos`, `deleteLibraryVideo`, `LibraryApiError` (Task 9); `summarizeBulkDeletion`, `hasActiveJob` (Task 9); `libraryKeys`.
- Produces:
  - `LibraryBulkDelete({ videos, selected, onDone })`: thanh hành động cùng hộp xác nhận;
  - `RetryDeleteButton({ video })`: nút "Thử xóa lại" cho video `DELETE_FAILED`.

- [ ] **Step 1: Viết test (fail)**

`routes/library/page.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_BASE_URL, READY_REQUEST_ID, libraryVideo } from '@/test/fixtures/control-plane';
import { server } from '@/test/msw/server';
import { renderApp } from '@/test/test-utils';
import { LibraryPage } from './page';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
const meta = { requestId: READY_REQUEST_ID };
const second = { ...libraryVideo, id: '0191f3d2-7f5b-7abc-8b2e-123456789e01', displayTitle: 'Video thứ hai', version: 2, latestJob: { id: '0191f3d2-7f5b-7abc-8b2e-123456789e02', kind: 'FULL_PIPELINE', status: 'RUNNING', progress: 10, currentTask: null, failure: null, updatedAt: libraryVideo.updatedAt } };
const failed = { ...libraryVideo, id: '0191f3d2-7f5b-7abc-8b2e-123456789f01', displayTitle: 'Video xóa lỗi', status: 'DELETE_FAILED', deletion: { requestedAt: libraryVideo.updatedAt, errorCode: 'STORAGE_DELETE_FAILED' } };
const list = (items: unknown[]) => http.get(`${CONTROL_PLANE_BASE_URL}/videos`, () => HttpResponse.json({ data: { items, nextCursor: null }, meta }));

describe('LibraryPage deletion', () => {
  beforeEach(() => { toast.success.mockReset(); toast.warning.mockReset(); toast.error.mockReset(); });

  it('selects videos, warns about running jobs and reports grouped results', async () => {
    const user = userEvent.setup(); let body: unknown = null;
    server.use(list([libraryVideo, second]), http.post(`${CONTROL_PLANE_BASE_URL}/videos/deletions`, async ({ request }) => { body = await request.json(); return HttpResponse.json({ data: { items: [{ videoId: libraryVideo.id, result: 'ACCEPTED', cancelledJobIds: [] }, { videoId: second.id, result: 'HAS_PUBLICATION_HISTORY', cancelledJobIds: [] }] }, meta }); }));
    renderApp(<LibraryPage />, { route: '/library' });
    await user.click(await screen.findByRole('checkbox', { name: 'Chọn tất cả trang này' }));
    expect(screen.getByText('Đã chọn 2 video')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa 2 video' }));
    expect(screen.getByRole('alertdialog', { name: 'Xóa 2 video?' })).toBeInTheDocument();
    expect(screen.getByText('1 video đang có job chạy, job sẽ bị hủy.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Xóa vĩnh viễn' }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Đã xóa 1 video. 1 video có lịch sử đăng bài nên được giữ lại.'));
    expect(body).toEqual({ items: [{ videoId: libraryVideo.id, version: 4 }, { videoId: second.id, version: 2 }] });
    expect(screen.queryByText('Đã chọn 2 video')).not.toBeInTheDocument();
  });

  it('selects a single row by name', async () => {
    const user = userEvent.setup(); server.use(list([libraryVideo, second]));
    renderApp(<LibraryPage />, { route: '/library' });
    await user.click(await screen.findByRole('checkbox', { name: `Chọn ${second.displayTitle}` }));
    expect(screen.getByRole('button', { name: 'Xóa 1 video' })).toBeInTheDocument();
  });

  it('shows failed deletions with a retry', async () => {
    const user = userEvent.setup(); let ifMatch: string | null = null;
    server.use(list([failed]), http.delete(`${CONTROL_PLANE_BASE_URL}/videos/:videoId`, ({ request }) => { ifMatch = request.headers.get('If-Match'); return HttpResponse.json({ data: { videoId: failed.id, status: 'DELETING', cancelledJobIds: [] }, meta }, { status: 202 }); }));
    renderApp(<LibraryPage />, { route: '/library' });
    expect((await screen.findAllByText('Xóa thất bại')).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: 'Thử xóa lại' })[0]!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Đã yêu cầu xóa lại video.'));
    expect(ifMatch).toBe('"4"');
  });
});
```

Nếu handler mặc định trong `test/msw/handlers.ts` đã trả một list video khác, `server.use(list(...))` sẽ ghi đè cho test này.

Run: `VITE_CONTROL_PLANE_URL=http://localhost:3000/v1 pnpm web:test -- routes/library`
Expected: FAIL (không có checkbox "Chọn tất cả trang này").

- [ ] **Step 2: Viết component bulk và retry**

`features/library/ui/library-bulk-delete.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { deleteLibraryVideo, deleteLibraryVideos, LibraryApiError, type LibraryVideo } from '../api/library-api';
import { libraryKeys } from '../api/library-query';
import { hasActiveJob, summarizeBulkDeletion } from '../model/video-deletion';

export function LibraryBulkDelete({ videos, onDone }: { videos: LibraryVideo[]; onDone: () => void }) {
  const [open, setOpen] = useState(false); const keys = useRef(new Map<string, string>()); const client = useQueryClient();
  const items = videos.map((video) => ({ videoId: video.id, version: video.version }));
  const running = videos.filter(hasActiveJob).length;
  const remove = useMutation({
    mutationFn: () => { const mapKey = JSON.stringify(items); const key = keys.current.get(mapKey) ?? crypto.randomUUID(); keys.current.set(mapKey, key); return deleteLibraryVideos(items, key); },
    onSuccess: async (results) => { setOpen(false); onDone(); await client.invalidateQueries({ queryKey: libraryKeys.lists() }); const summary = summarizeBulkDeletion(results); if (summary.tone === 'success') toast.success(summary.message); else toast.warning(summary.message); },
    onError: (error) => { toast.error(error instanceof LibraryApiError ? error.message : 'Không thể xóa các video đã chọn.'); },
  });
  if (!videos.length) return null;
  return <div className="library-bulk-bar" role="region" aria-label="Thao tác hàng loạt">
    <span>Đã chọn {videos.length} video</span>
    <Button variant="destructive" size="sm" onClick={() => setOpen(true)}><Trash2Icon />Xóa {videos.length} video</Button>
    <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Xóa {videos.length} video?</AlertDialogTitle><AlertDialogDescription>Xóa vĩnh viễn video gốc, audio, video kết quả, SRT và transcript của các video đã chọn. Không thể khôi phục.</AlertDialogDescription>{running > 0 && <AlertDialogDescription>{running} video đang có job chạy, job sẽ bị hủy.</AlertDialogDescription>}</AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Quay lại</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={(event) => { event.preventDefault(); remove.mutate(); }}>Xóa vĩnh viễn</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export function RetryDeleteButton({ video }: { video: LibraryVideo }) {
  const client = useQueryClient(); const key = useRef<string | null>(null);
  const retry = useMutation({
    mutationFn: () => { key.current ??= crypto.randomUUID(); return deleteLibraryVideo(video, key.current); },
    onSuccess: async () => { key.current = null; await client.invalidateQueries({ queryKey: libraryKeys.lists() }); toast.success('Đã yêu cầu xóa lại video.'); },
    onError: (error) => { key.current = null; toast.error(error instanceof LibraryApiError ? error.message : 'Không thể xóa video.'); },
  });
  return <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>Thử xóa lại</Button>;
}
```

- [ ] **Step 3: Sửa trang Thư viện**

Trong `routes/library/page.tsx`:

- Import `Checkbox` từ `@/components/ui/checkbox`, cùng `LibraryBulkDelete` và `RetryDeleteButton`.
- Trong `LibraryPage`:
  - thêm `const [selected, setSelected] = useState<Set<string>>(new Set());`;
  - sau khối `ListState`/`LibraryList`, render
    `<LibraryBulkDelete videos={videos.filter((video) => selected.has(video.id))} onDone={() => setSelected(new Set())} />`;
  - truyền `selected` và `onSelectedChange={setSelected}` vào `LibraryList`.
- Đổi `LibraryList` thành
  `function LibraryList({ videos, selected, onSelectedChange }: { videos: LibraryVideo[]; selected: Set<string>; onSelectedChange: (next: Set<string>) => void })`, và:
  - `const selectable = videos.filter((video) => video.capabilities.canDelete);`
    `const allChecked = selectable.length > 0 && selectable.every((video) => selected.has(video.id));`
    `const toggle = (id: string, checked: boolean) => { const next = new Set(selected); if (checked) next.add(id); else next.delete(id); onSelectedChange(next); };`;
  - thêm cột đầu ở header:
    `<TableHead><Checkbox aria-label="Chọn tất cả trang này" checked={allChecked} disabled={!selectable.length} onCheckedChange={(checked) => onSelectedChange(checked === true ? new Set(selectable.map((video) => video.id)) : new Set())} /></TableHead>`;
  - thêm ô đầu ở mỗi dòng:
    `<TableCell><Checkbox aria-label={`Chọn ${video.displayTitle || 'video chưa có tiêu đề'}`} checked={selected.has(video.id)} disabled={!video.capabilities.canDelete} onCheckedChange={(checked) => toggle(video.id, checked === true)} /></TableCell>`;
  - ô thao tác của dòng: nếu `video.status === 'DELETE_FAILED'`, render `<RetryDeleteButton video={video} />` trước nút "Chi tiết". Ở card mobile cũng làm tương tự.
- Trong `Status`, thêm `DELETING: 'Đang xóa', DELETE_FAILED: 'Xóa thất bại'` vào map.
- Thêm vào `apps/web/src/app/styles/globals.css`, cạnh các rule `.queue-filters`, một rule dùng token có sẵn:
  `.library-bulk-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3, 12px); }`.
  Không đặt màu mới.

- [ ] **Step 4: Chạy test**

Run: `VITE_CONTROL_PLANE_URL=http://localhost:3000/v1 pnpm web:test && pnpm --filter @reup-dubbing-studio/web typecheck && pnpm --filter @reup-dubbing-studio/web lint`
Expected: PASS, không có act() warning. Kiểm `apps/web/e2e/*.spec.ts` có selector nào đếm số cột bảng Thư viện không (`grep -rn "library" apps/web/e2e`). Nếu có, cập nhật cho cột checkbox mới. Không chạy được Playwright ở đây, nên ghi rõ điều đó trong report.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/library/ui/library-bulk-delete.tsx apps/web/src/routes/library apps/web/src/app/styles
git commit -m "feat(web): select and delete videos from the library"
```

---

### Task 12: Tài liệu và kiểm tra toàn bộ

**Files:**
- Modify: `docs/architecture/video-library.md` (thêm mục "Xóa video")
- Modify: `docs/superpowers/specs/2026-09-27-video-deletion-design.md` (đổi trạng thái)

- [ ] **Step 1: Cập nhật tài liệu kiến trúc**

Thêm vào cuối `docs/architecture/video-library.md` mục `## Xóa video`, 8–12 dòng:

- nêu luồng hai pha;
- ghi rằng `DELETING` bị loại khỏi list, còn `DELETE_FAILED` vẫn hiện;
- ghi rằng video có `PublicationProof` không xóa được;
- ghi rằng tập asset do `collectVideoAssetIds` quyết định, còn asset của profile, voice và video khác thì được giữ;
- ghi grace 15 phút và backoff `1/5/15/60` phút, 6 lần;
- link tới spec.

Trong spec, đổi `**Trạng thái:** \`DRAFT\`, chờ duyệt.` thành `**Trạng thái:** \`IMPLEMENTED\`.`, và thêm một dòng ở §2 hoặc §3.4 trỏ tới mục "Rulings" của plan này cho thứ tự xóa đã sửa.

- [ ] **Step 2: Chạy toàn bộ kiểm tra**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm contract:verify
VITE_CONTROL_PLANE_URL=http://localhost:3000/v1 pnpm web:test
pnpm --filter @reup-dubbing-studio/api test:e2e
```

Expected: tất cả PASS. Ghi vào report số test pass của từng lệnh.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/video-library.md docs/superpowers/specs/2026-09-27-video-deletion-design.md
git commit -m "docs: document two-phase video deletion"
```

- [ ] **Step 4: Kiểm tra thủ công (người vận hành, sau khi merge và rebuild compose)**

1. `docker compose up -d --build api web`.
2. Tạo một video test bằng "Nhập video", rồi mở chi tiết và bấm "Xóa video" → "Xóa vĩnh viễn".
3. Video biến khỏi Thư viện ngay.
4. Trong khoảng một phút, bucket R2 không còn object dưới `local-imports/<assetId>/`, cũng không còn các key output của video đó.
