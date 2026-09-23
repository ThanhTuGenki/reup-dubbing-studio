# Dashboard home — operational projection

- **Trạng thái:** `ACCEPTED`.
- **Cập nhật:** 2026-09-23.
- **Nguồn chuẩn cho:** KPI, cảnh báo, hoạt động gần đây và boundary API của màn
  Tổng quan.
- **Không thay thế:** lifecycle chi tiết trong tài liệu Queue, Library, Worker và
  Manual Publishing.

## 1. Mục tiêu và boundary

Dashboard home là read model tổng hợp cho một workspace duy nhất. Nó giúp người
vận hành trả lời nhanh bốn câu hỏi:

1. Có bao nhiêu video đang xử lý, chờ duyệt, sẵn sàng đăng và đã đăng?
2. Queue hoặc publication task nào cần xử lý ngay?
3. Worker nào đang lỗi, offline hoặc vẫn phát sinh chi phí nhưng có thể tắt?
4. Hoạt động vận hành gần nhất là gì và cần mở màn chi tiết nào?

MVP chỉ đọc PostgreSQL hiện có. Không tạo counter table, materialized view,
notification table hoặc background aggregation job. API tính projection tại thời
điểm request; cache HTTP ngắn hạn có thể bổ sung sau khi đo tải thực tế.

Dashboard không chạy Worker, không tự thuê/xóa EzyCloudX, không tự đăng mạng xã
hội và không biến quick action thành mutation ngầm.

## 2. Thời gian và phạm vi

- `generatedAt` là server time UTC và được trả trong response.
- Mọi timestamp trên wire là ISO 8601 UTC.
- Nhóm ngày, nhãn lịch và ngưỡng “hôm nay” hiển thị theo
  `Asia/Ho_Chi_Minh`; Web không tự diễn giải theo timezone của trình duyệt.
- Video `ARCHIVED`, publication task `CANCELLED` và worker `TERMINATED` không vào
  KPI đang hoạt động, nhưng vẫn có thể xuất hiện trong activity nếu event nằm
  trong cửa sổ gần đây.
- Upcoming publishing dùng cửa sổ `[now, now + 7 ngày]`.
- Recent activity lấy tối đa 12 mục; attention lấy tối đa 20 mục nhưng luôn trả
  `total` để UI biết còn dữ liệu ở màn chi tiết.

## 3. KPI đã chốt

### 3.1 Video

API trả count theo mọi `VideoStatus` để Web không phải suy từ danh sách phân
trang. Bốn KPI chính là:

| KPI | Nguồn |
|---|---|
| Đang xử lý | `INGEST_QUEUED`, `INGESTING`, `INGESTED`, `PROCESSING` |
| Chờ duyệt | `AWAITING_REVIEW` |
| Sẵn sàng đăng | `READY_TO_PUBLISH` |
| Đã đăng | `PUBLISHED` |

`FAILED` được trả riêng và tạo attention. `totalActive` loại `ARCHIVED`.

### 3.2 Queue

- `active`: `QUEUED`, `RUNNING`, `WAITING_FOR_GPU`, `WAITING_FOR_REVIEW`.
- `running`: `RUNNING`.
- `waitingForGpu`: `WAITING_FOR_GPU`.
- `failed`: mọi job hiện có status `FAILED`.

Không cộng task count vào job count. Link attention luôn trỏ tới job detail.

### 3.3 Publishing

- `upcoming`: task chưa kết thúc có `scheduledAt` trong 7 ngày tới.
- `overdue`: `deadlineAt < now` và status không thuộc
  `PUBLISHED | VERIFIED | CANCELLED`.
- `awaitingProof`: `POSTING_MANUAL`.
- `awaitingVerification`: `PUBLISHED`.
- `needsRevision`: `NEEDS_REVISION`.

Task không có lịch vẫn được tính theo status, nhưng không thuộc upcoming.

### 3.4 Worker và chi phí

- `online`: `READY | BUSY | DRAINING | SAFE_TO_TERMINATE`.
- `busy`: `BUSY`.
- `safeToTerminate`: `SAFE_TO_TERMINATE`.
- `unhealthy`: `OFFLINE | ERROR`.
- `activeLeases`: tổng lease chưa release của session đang mở.

Chi phí chỉ lấy billing session chưa đóng. `estimatedCostCp` được tính tại server
bằng `hourlyRateCp × elapsedSeconds / 3600`, dùng decimal và trả string. Chi phí
VND chỉ là ước tính từ snapshot `paidVndPerCp`:

- trả tổng VND khi mọi session mở đều có tỷ giá;
- trả `null` và `vndCoverage: PARTIAL` khi chỉ một phần có tỷ giá;
- trả `null` và `vndCoverage: NONE` khi không session nào có tỷ giá;
- `COMPLETE` khi không thiếu tỷ giá, kể cả trường hợp không có session mở.

Không xem CP/VND là hóa đơn và không cộng billing session đã đóng vào “chi phí
đang chạy”.

## 4. Attention contract

Mỗi mục gồm `code`, `severity`, `title`, `detail`, `entityType`, `entityId`,
`occurredAt`, `dueAt` nullable và `href`. Chỉ trả copy an toàn; không trả log thô,
credential, object key, signed URL hoặc provider payload.

Thứ tự: `CRITICAL` trước `WARNING`, sau đó `dueAt/occurredAt` tăng dần và `id` để
ổn định. Các code MVP:

| Code | Severity | Điều kiện |
|---|---|---|
| `WORKER_BILLING_SAFE_TO_TERMINATE` | `CRITICAL` | Worker `SAFE_TO_TERMINATE` còn billing session mở |
| `WORKER_BILLING_OFFLINE` | `CRITICAL` | Worker `OFFLINE | ERROR` còn billing session mở |
| `PUBLICATION_OVERDUE` | `CRITICAL` | Publication deadline đã qua và chưa hoàn tất |
| `SOURCE_CREDENTIAL_EXPIRED` | `CRITICAL` | Source account/credential expired, invalid hoặc revoked |
| `QUEUE_JOB_FAILED` | `WARNING` | Job status `FAILED` |
| `PUBLICATION_NEEDS_REVISION` | `WARNING` | Task status `NEEDS_REVISION` |
| `SOURCE_CREDENTIAL_EXPIRING` | `WARNING` | Credential hết hạn trong 72 giờ |
| `QUEUE_WAITING_FOR_GPU` | `WARNING` | Job chờ GPU liên tục ít nhất 15 phút |
| `SOURCE_ACCOUNT_COOLDOWN` | `WARNING` | Source account còn trong cooldown |

Không có read/unread, dismiss hoặc badge persistent. Attention biến mất khi dữ
liệu nguồn đã được xử lý; điều hướng sang màn nguồn là cách giải quyết.

## 5. Recent activity

Không suy event từ `updatedAt` chung vì không biết hành động thực tế. Projection
hợp nhất các nguồn có semantics rõ ràng:

- `workflow_events` cho Queue/Video lifecycle;
- `audit_events` cho user/system action đã được ghi audit;
- `publication_proofs.submitted_at` và `verified_at` cho proof lifecycle.

Mỗi mục trả `kind`, `title`, `detail` an toàn, entity reference, `occurredAt` và
`href`. API deduplicate audit/workflow record của cùng queue action theo
`entityId + action/eventType + time bucket 1 giây`, ưu tiên workflow event vì có
transition. Không bịa activity cho domain chưa ghi event.

## 6. API projection

Một endpoint read-only:

```text
GET /v1/dashboard
```

Response gồm:

```text
generatedAt, timezone
videos: countsByStatus + four headline counts + totalActive + failed
queue: active + running + waitingForGpu + failed
publishing: upcoming + overdue + awaitingProof + awaitingVerification + needsRevision
workers: online + busy + safeToTerminate + unhealthy + activeLeases
cost: openBillingSessions + estimatedCostCp + estimatedCostVnd + vndCoverage
attention: items + total
recentActivity: items
```

Đây là wire model mới nên phải khai báo trong OpenAPI, generate vào
`packages/api-contract` và chỉ được dùng qua `packages/api-client`.

Mọi section luôn có shape ổn định và count `0` khi rỗng. Field nullable chỉ dành
cho dữ liệu thực sự không thể tính, như tổng VND thiếu tỷ giá. Nếu PostgreSQL
không đọc được, endpoint trả Problem Details thay vì response “partial” giả.
“Partial data” ở Web nghĩa là một số domain rỗng hoặc optional estimate không có,
không phải nuốt lỗi backend.

## 7. Quick actions

Quick action là link Web tĩnh, được sắp theo attention/count chứ không do API trả
command:

- Quét nguồn → `/discovery`;
- Xem queue → `/queue`;
- Duyệt video → `/library` với filter phù hợp khi filter URL được hỗ trợ;
- Mở bàn đăng bài → `/publishing`;
- Quản lý worker → `/workers`.

Không hiển thị action giả thành công. Action cần mutation vẫn phải thực hiện tại
màn feature sở hữu aggregate và tuân thủ ETag/idempotency của feature đó.

## 8. Acceptance

- count khớp query trực tiếp từ các bảng nguồn và loại đúng terminal state;
- ngưỡng 72 giờ, 15 phút và 7 ngày được test tại boundary bằng server clock cố định;
- worker billing dùng decimal, không float làm nguồn chuẩn và xử lý tỷ giá partial;
- attention sort ổn định, giới hạn item nhưng giữ total;
- recent activity không trùng queue action và không lộ dữ liệu nhạy cảm;
- empty database trả projection đầy đủ với các count bằng `0`;
- Web render được empty/partial optional data, dùng timezone Việt Nam và deep-link
  đúng màn chi tiết;
- không tạo counter, notification hoặc background aggregation table.
