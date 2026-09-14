# ADR: Node 24 tooling baseline

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: baseline tooling của pnpm TypeScript workspace trong monorepo, gồm phiên bản Node.js, package scope và vị trí Prisma schema.
- Không phải nguồn chuẩn cho: runtime implementation, endpoint design, deployment configuration, hoặc toolchain Python của worker.
- Thay thế: [ADR monorepo tooling baseline](2026-09-07-monorepo-tooling.md).
- Được thay thế bởi: `—`.

Vòng đời: `DRAFT → ACCEPTED → SUPERSEDED | DEPRECATED`.

## Bối cảnh

API Foundation cần một runtime Node thống nhất cho root workspace và `apps/api`.
ADR tooling trước đó đã chấp nhận pnpm cùng Node LTS 22. Owner đã quyết định chuyển
baseline sang Node 24 trước khi foundation được tích hợp, nên phạm vi version của
ADR cũ không còn là nguồn chuẩn hiện hành.

## Quyết định

- Pin Node LTS 24 qua root `engines.node` là `>=24 <25` và `.nvmrc` thuộc major 24.
- Giữ pnpm thuần cho TypeScript workspace và giữ package scope
  `@reup-dubbing-studio/*`; quyết định này không thay đổi các lựa chọn đó.
- Khi Prisma được triển khai, schema thuộc `apps/api/prisma/schema.prisma`, gần
  Control Plane sở hữu domain data; foundation không tạo schema này.
- Worker Python tiếp tục dùng môi trường `uv` độc lập.

## Lựa chọn đã cân nhắc

- Giữ Node LTS 22: loại vì mâu thuẫn với quyết định Owner cho API Foundation.
- Không pin major Node: loại vì tạo drift giữa local, CI và production, làm giảm khả
  năng tái lập của workspace.

## Hệ quả

- Mọi script workspace, CI và tài liệu chạy API phải dùng Node 24 trong phạm vi
  đã pin.
- `2026-09-07-monorepo-tooling.md` được đánh dấu `SUPERSEDED`; các quyết định pnpm,
  package scope và vị trí Prisma được lặp lại đầy đủ trong ADR này như nguồn chuẩn
  hiện hành.
- Thay đổi không thêm Docker, provider, endpoint nghiệp vụ hay media processing.

## Cách kiểm chứng

- `node --version` trả major `24` trong môi trường quality gate.
- Root `package.json` và `.nvmrc` khớp giới hạn Node của ADR này.
- `pnpm install --lockfile-only`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:e2e`, `pnpm depcruise` và `pnpm contract:lint` chạy với Node 24.
