# ADR: Monorepo tooling baseline

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: tooling baseline của monorepo scaffold.
- Không phải nguồn chuẩn cho: runtime implementation, endpoint design, hay deployment configuration.

## Bối cảnh

Issue #6 cần một khung monorepo tối thiểu bám theo [`../application.md`](../application.md) §4.

## Quyết định

- Dùng pnpm thuần cho workspace TypeScript; không thêm một monorepo orchestrator khác ở giai đoạn scaffold.
- Pin Node vào LTS 22 qua root `engines.node` (`>=22 <23`); phiên bản pnpm được pin qua `packageManager`.
- Dùng package scope thống nhất `@reup-dubbing-studio/*` cho cả apps và packages.
- Prisma schema, khi được triển khai, đặt tại `apps/api/prisma/schema.prisma`, gần Control Plane sở hữu domain data; scaffold này chưa tạo schema.

## Hệ quả

Workspace chỉ bao gồm `apps/*` và `packages/*`; worker Python tiếp tục có môi trường uv độc lập.
