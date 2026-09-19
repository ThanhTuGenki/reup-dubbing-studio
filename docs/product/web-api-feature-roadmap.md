# Roadmap Web + API theo feature

- **Trạng thái:** `ACTIVE`
- **Nguồn chuẩn cho:** thứ tự triển khai và tiến độ cấp feature của Web Dashboard
  và Control Plane API.
- **Không phải nguồn chuẩn cho:** endpoint/schema chi tiết, acceptance criteria,
  thiết kế UI chi tiết hoặc implementation của GPU Worker.
- **Phạm vi:** `apps/web`, `apps/api`, OpenAPI contract, PostgreSQL migration và
  các package contract/client liên quan.

## Quy ước

- Mỗi feature được triển khai theo vertical slice Web + API.
- Khi bắt đầu một feature, phân tích và chốt contract/schema chi tiết lúc đó;
  roadmap này chỉ giữ phạm vi cấp cao.
- Chỉ đánh dấu feature hoàn tất khi Web, API, integration và kiểm thử tương ứng
  đều hoàn tất.
- Hệ thống là single-workspace, MVP không có login.
- Không triển khai code trong `workers/gpu`. Màn hình GPU Workers và API quản lý
  worker của Control Plane vẫn thuộc phạm vi.

## 0. Nền tảng dùng chung

- [x] API foundation: NestJS/Fastify, convention HTTP, error envelope, request ID
  và test baseline.
- [x] Web foundation: React/Vite, router, TanStack Query, error boundary và test
  baseline.
- [x] shadcn + Tailwind theme adapter từ OpenDesign.
- [x] Hoàn thiện application shell dùng shadcn Sidebar, topbar, responsive
  navigation và route metadata.
- [x] Chuẩn hóa OpenAPI generation, typed API client và MSW fixture dùng chung.
- [ ] Chuẩn hóa pagination, filter, empty/loading/error state và query-key factory.
- [ ] Thiết lập SSE client dùng chung cho progress/status và cơ chế refetch sau
  reconnect.
- [ ] Chốt quy ước upload/download asset bằng presigned URL.

## 1. Cài đặt hệ thống

- [ ] **Hoàn tất feature Cài đặt.**
  - [ ] Phân tích các nhóm cấu hình và chốt contract/schema cần dùng.
  - [ ] API đọc/cập nhật cấu hình, credential mã hóa và kiểm tra kết nối phù hợp.
  - [ ] Web xây màn hình form theo từng nhóm, validation và trạng thái lưu/test.
  - [ ] Integration test bảo đảm secret không bị trả ngược hoặc ghi log.

## 2. Hồ sơ kênh và series

- [ ] **Hoàn tất feature Hồ sơ.**
  - [ ] Phân tích inheritance Channel/Series Profile và chốt contract/schema.
  - [ ] API CRUD profile, cấu hình pipeline, mask subtitle và asset liên quan.
  - [ ] Web xây danh sách, tạo/sửa, cấu hình series và mask editor.
  - [ ] Kiểm thử validation, inheritance và snapshot cấu hình khi tạo job.

## 3. Thư viện giọng

- [ ] **Hoàn tất feature Thư viện giọng.**
  - [ ] Phân tích metadata giọng, sample và quy tắc sử dụng rồi chốt contract.
  - [ ] API CRUD voice profile, quản lý sample asset và trạng thái khả dụng.
  - [ ] Web xây danh sách, bộ lọc, form tạo/sửa và nghe sample.
  - [ ] Kiểm thử asset flow và các trạng thái thiếu/lỗi sample.

## 4. Discovery, nguồn và watchlist

- [ ] **Hoàn tất feature Discovery.**
  - [ ] Xác minh adapter Douyin theo tài liệu discovery và chốt contract/schema.
  - [ ] API quản lý source credential, category/creator/watchlist, scan run,
    cursor, deduplication và danh sách source content.
  - [ ] Web xây chọn nguồn, filter, scan, bảng kết quả, selection và watchlist.
  - [ ] Kiểm thử cookie hết hạn, rate limit, partial result, cursor và chống trùng.

## 5. Tạo job ingest

- [ ] **Hoàn tất feature Tạo job.**
  - [ ] Phân tích flow chọn video → profile → xác nhận và chốt contract/schema.
  - [ ] API validate selection, tạo video/ingest job/task idempotent và trả trạng
    thái khởi tạo.
  - [ ] Web xây wizard/dialog xác nhận, hiển thị duplicate và nói rõ chưa chạy GPU.
  - [ ] Kiểm thử tạo một/nhiều job, retry request và điều hướng sang Queue.

## 6. Hàng đợi xử lý

- [ ] **Hoàn tất feature Queue.**
  - [ ] Phân tích lifecycle job/task và các action được phép theo từng trạng thái.
  - [ ] API list/detail/filter job, progress, attempt/log an toàn, retry/cancel và
    SSE status update.
  - [ ] Web xây bảng queue, progress, filter, detail/drawer và action retry/cancel.
  - [ ] Kiểm thử state transition, stale update, reconnect và error recovery.

## 7. GPU Workers

- [ ] **Hoàn tất feature GPU Workers phía Web + API.**
  - [ ] Phân tích enrollment/session/heartbeat/drain và chốt contract/schema.
  - [ ] API quản lý worker registry, enrollment, approved image, session,
    heartbeat mới nhất và billing session.
  - [ ] Web xây danh sách worker, trạng thái/capacity, thêm worker, drain và hướng
    dẫn xóa rental thủ công.
  - [ ] Kiểm thử offline timeout, revoke credential và version mismatch.
  - [ ] Xác nhận không thêm hoặc sửa implementation trong `workers/gpu`.

## 8. Thư viện video

- [ ] **Hoàn tất feature Library.**
  - [ ] Phân tích aggregate trạng thái video, filter và asset cần hiển thị.
  - [ ] API list/detail/filter video, profile liên quan, output và asset metadata.
  - [ ] Web xây bảng/card responsive, filter, trạng thái và điều hướng vào Studio.
  - [ ] Kiểm thử pagination, empty/error state và presigned download.

## 9. Chi tiết video và Studio biên tập

- [ ] **Hoàn tất feature Studio.**
  - [ ] Phân tích player, transcript, cast, revision, review và render flow rồi
    chốt contract/schema.
  - [ ] API đọc/sửa segment, gán voice/cast, tạo preview/re-gen request, lưu review
    decision và yêu cầu render.
  - [ ] Web xây player, segment editor, cast sheet, audio preview, dirty state và
    review/render actions.
  - [ ] Tích hợp SSE/polling cho preview và render status mà không triển khai Worker.
  - [ ] Kiểm thử conflict khi sửa, retry, unsaved changes và accessibility editor.

## 10. Chính sách tự động hóa và điểm duyệt

- [ ] **Hoàn tất feature Review policy.**
  - [ ] Phân tích policy inheritance và các approval gate cần hỗ trợ.
  - [ ] API đọc/cập nhật policy có version và snapshot policy vào workflow.
  - [ ] Web xây form policy, mô tả tác động và validation phụ thuộc.
  - [ ] Kiểm thử thay đổi policy không làm đổi job đang chạy.

## 11. Bàn đăng bài

- [ ] **Hoàn tất feature Publishing.**
  - [ ] Phân tích publish package/task/field/checklist/proof và chốt contract/schema.
  - [ ] API quản lý package, metadata field, checklist, asset download và nhiều lần
    ghi nhận publication proof.
  - [ ] Web xây calendar/list, package detail, copy field, download asset, checklist
    và form xác nhận URL/post ID.
  - [ ] Kiểm thử manual publishing flow, validation proof và trạng thái hoàn tất.

## 12. Tổng quan

- [ ] **Hoàn tất feature Dashboard home.**
  - [ ] Chốt KPI/cảnh báo sau khi các nguồn dữ liệu bên dưới đã ổn định.
  - [ ] API cung cấp projection tổng hợp cho video, queue, publishing, worker và
    chi phí; không tạo counter table sớm.
  - [ ] Web xây KPI, danh sách việc cần chú ý, hoạt động gần đây và quick actions.
  - [ ] Kiểm thử dữ liệu rỗng/partial, timezone và tính nhất quán với màn chi tiết.

## 13. Hoàn thiện liên feature

- [ ] Hoàn thiện navigation, breadcrumb, command/search và deep-link toàn hệ thống.
- [ ] Hoàn thiện toast/SSE transient; không tạo notification center persistent.
- [ ] Chạy accessibility và responsive QA cho các viewport đã chốt.
- [ ] Chạy contract test, integration test và Playwright cho các flow chính.
- [ ] Rà soát security: secret redaction, presigned URL, input validation và audit.
- [ ] Rà soát performance: query/index, bundle splitting và list virtualization khi
  có dữ liệu thực tế.
- [ ] Cập nhật tài liệu vận hành và đánh dấu toàn bộ feature hoàn tất.
