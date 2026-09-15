# ADR: Hexagonal mỏng theo vertical slice cho Control Plane

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: placement và dependency direction của code Control Plane.
- Không phải nguồn chuẩn cho: endpoint inventory, schema dữ liệu, provider hay deployment.
- Thay thế: [`2026-09-07-api-module-layout.md`](2026-09-07-api-module-layout.md)
- Được thay thế bởi: —

## Bối cảnh

Control Plane vẫn là modular monolith, nhưng danh sách 14 module định trước khiến
foundation mang placeholder cho nghiệp vụ chưa được kiểm chứng. Vertical Slice
Delivery cần một quy tắc placement rõ mà chỉ tạo boundary khi có code thật.

Quyết định này giữ lại modular monolith, việc tách controller web/worker khi có
hai consumer, quy tắc không tạo cycle Workflow/Tasks và quyền sở hữu Prisma tương
lai từ ADR cũ. Nó thay requirement về inventory module/tầng dựng sẵn.

## Quyết định

- `src/platform` chỉ sở hữu capability kỹ thuật cross-cutting như config, HTTP,
  observability, security và health; platform không import business slice.
- Mỗi business capability được tạo Just-in-Time tại `src/modules/<slice>` khi
  vertical slice đầu tiên có hành vi thật. Không tạo module, DTO, port, adapter
  hoặc directory rỗng cho feature tương lai.
- `http/web` và `http/worker` là inbound adapter, chỉ được tạo cho consumer đang
  tồn tại. Chúng validation/translate wire data rồi gọi application use case.
- `application` chứa use case và port, phụ thuộc domain nhưng không phụ thuộc
  Nest/Fastify, database, queue, object store hoặc worker SDK.
- `domain` chứa rule thuần và không phụ thuộc framework/I/O.
- `infrastructure` triển khai outbound port; không import HTTP adapter.
- Module chỉ công bố public API qua entry point của chính module. Module khác
  không deep-import file nội bộ.
- `app.module.ts` và application bootstrap là composition root duy nhất được
  phép ghép platform, module và infrastructure implementation.

## Lựa chọn đã cân nhắc

- Giữ inventory 14 module: bỏ vì khóa sớm ownership và sinh placeholder.
- Một kiến trúc layer ngang toàn ứng dụng: bỏ vì làm boundary feature khó thấy và
  tăng coupling giữa các slice.
- Không có dependency rule: bỏ vì convention tài liệu đơn lẻ dễ drift.

## Hệ quả

Mỗi slice có thể nhỏ và chỉ mang những layer nó thực sự cần. Domain/application
dễ unit test, còn framework/I/O nằm ở adapter. Composition root có coupling rộng
có chủ đích. Dependency-cruiser phải kiểm tra cycle, framework/I/O import từ core,
infrastructure → HTTP, platform → module và deep import giữa module.

API tiếp tục chỉ nhận request, validation, authorization/metadata và điều phối;
media, FFmpeg, GPU và tác vụ dài hạn thuộc worker, không chạy trong HTTP request.

## Cách kiểm chứng

- `pnpm depcruise` pass trên `apps/api/src` và fail với fixture vi phạm.
- Foundation không chứa `src/modules/` hay placeholder nghiệp vụ.
- Review slice mới xác nhận dependency hướng vào domain/application port và chỉ
  composition root ghép concrete adapter.
