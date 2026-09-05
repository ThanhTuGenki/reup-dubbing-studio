# Tài liệu — Reup Dubbing Studio

Chia theo **mục đích**, không theo công cụ và không theo ngày. Trước khi viết tài
liệu mới, tìm đúng ô trong bảng dưới; không có ô nào hợp thì hỏi trước khi tạo
thư mục mới.

## Nguồn chuẩn cho từng loại

| Cần biết | Đọc | Trạng thái |
|---|---|---|
| Vấn đề, người dùng, phạm vi, luồng nghiệp vụ | [`product/design.md`](product/design.md) | `ACCEPTED` (§12 đã bị thay thế) |
| Stack, cấu trúc monorepo, contract-first, CI gate | [`architecture/application.md`](architecture/application.md) | `ACCEPTED` |
| Thiết kế các stage của pipeline media | [`architecture/mvp-pipeline.md`](architecture/mvp-pipeline.md) | thiết kế `ACCEPTED`, triển khai `ARCHIVED` |
| Quyết định kiến trúc đơn lẻ | [`architecture/decisions/`](architecture/decisions/) | mỗi ADR một file |
| **Contract giữa web ↔ api ↔ worker** | `contracts/openapi/*.yaml` ở **gốc repo** | không nằm trong `docs/` |
| Chạy pipeline bằng tay, việc cần người làm | [`operations/manual-checklist.md`](operations/manual-checklist.md) | runbook |
| Kết quả các lần chạy thủ công | [`operations/acceptance-log.md`](operations/acceptance-log.md) | log, append |
| Nợ kỹ thuật đã biết | [`operations/known-followups.md`](operations/known-followups.md) | ⚠️ tracker tạm |
| Bố cục màn hình và route đã duyệt | [`reference/ui-prototype/`](reference/ui-prototype/) | `ARCHIVED` |
| **Trạng thái công việc** | [GitHub Project #1](https://github.com/users/ThanhTuGenki/projects/1) | **không nhân đôi vào file** |

## Bốn quy tắc

**1. Ngày chỉ nằm trong tên file của thứ bất biến.** ADR và log được đặt tên
`YYYY-MM-DD-<slug>.md` vì chúng ghi lại một thời điểm. Spec thì **sống** — nó được
cập nhật tại chỗ, nên tên file không mang ngày. Ngày trong tên một tài liệu sống sẽ
nói dối về độ tươi của nó.

**2. Mỗi tài liệu mở đầu bằng khối trạng thái.** Tối thiểu: `Trạng thái`
(`DRAFT` · `ACCEPTED` · `SUPERSEDED` · `ARCHIVED`), **nguồn chuẩn cho cái gì**, và
**không phải nguồn chuẩn cho cái gì**.

**3. Thay thế thì phải nói ra ở CẢ HAI đầu.** Tài liệu cũ ghi `SUPERSEDED` kèm link
tới cái thay nó; tài liệu mới ghi nó thay cái gì. Một chiều là không đủ — người đọc
có thể vào từ bất kỳ đầu nào.

> Đây là luật đắt nhất trong file này. Trước 2026-09-05, `product/design.md` §12
> nói backend là **FastAPI + Redis/RQ** còn `architecture/application.md` §2 nói
> **NestJS + PostgreSQL queue**. Không tài liệu nào biết tài liệu kia tồn tại, và
> có tới **hai** nơi nói FastAPI. Ai đọc repo cũng sẽ tin phe đông hơn.

**4. Đừng đặt tên thư mục theo công cụ.** Cấu trúc cũ có `docs/superpowers/` —
tên của công cụ sinh ra tài liệu, không phải nội dung tài liệu. Đổi công cụ thì thư
mục thành vô nghĩa, hoặc agent mới ghi sang chỗ khác và thành hai nơi.

## Tài liệu mới đặt ở đâu

| Khi nào | Viết vào |
|---|---|
| Đổi hành vi người dùng | `product/` |
| Quyết định kiến trúc có trade-off dài hạn | `architecture/decisions/YYYY-MM-DD-<slug>.md` |
| Đổi giao tiếp web ↔ api ↔ worker | `contracts/openapi/` ở gốc repo, **không** phải `docs/` |
| Đổi cách deploy, vận hành, xử lý lỗi | `operations/` |
| Tài liệu chỉ để tra, không còn dẫn dắt triển khai | `reference/` + đánh dấu `ARCHIVED` |

**Tri thức của chính repo này** — lệnh chạy test, quirk, cách generate contract —
viết vào `AGENTS.md` ở gốc repo, không vào `docs/`. Đó là file duy nhất agent đọc
tự động khi mở repo.
