# Reup Dubbing Studio — Kiến trúc ứng dụng và công nghệ

- **Ngày tạo:** 2026-09-02
- **Trạng thái:** `ACCEPTED` (chốt sơ bộ, dùng làm nền cho các vòng phân tích chi tiết)
- **Nguồn chuẩn cho:** stack kỹ thuật, cấu trúc monorepo, contract-first, CI gate.
- **Thay thế:** §12 *Tech stack* của [`docs/product/design.md`](../product/design.md).
  Backend đổi FastAPI → NestJS; hàng đợi đổi Redis/RQ → PostgreSQL task queue.
- **Phạm vi:** Cấu trúc source code, runtime, giao tiếp giữa Control Plane và GPU Worker, lưu trữ, chiến lược concurrency và quy trình phát triển song song
- **Không thuộc phạm vi tài liệu này:** Database schema chi tiết, API endpoint đầy đủ, thuật toán media, cấu hình production cuối cùng và mã nguồn triển khai
- **Thiết kế nghiệp vụ nguồn:** [`docs/product/design.md`](../product/design.md)
- **UI prototype (đã archive):** [`docs/reference/ui-prototype/index.html`](../reference/ui-prototype/index.html)

## 1. Mục tiêu kiến trúc

Kiến trúc phải đáp ứng các đặc điểm chính của Reup Dubbing Studio:

1. Web app và Control Plane chạy liên tục trên VPS.
2. GPU Worker chạy trên Docker GPU thuê theo giờ và có thể biến mất bất kỳ lúc nào.
3. Pipeline video kéo dài, có retry, có bước chờ người duyệt và có thể tiếp tục sau nhiều giờ hoặc nhiều ngày.
4. Video, audio, SRT và thumbnail không đi xuyên qua API server.
5. Một GPU Worker phải tận dụng được CPU, I/O và GPU song song mà không chạy quá tải VRAM.
6. Thuê thêm GPU không yêu cầu sửa code hoặc deploy lại Control Plane.
7. Kiến trúc giai đoạn đầu phải đủ đơn giản để một nhóm nhỏ vận hành, nhưng có đường nâng cấp khi tải tăng.

## 2. Các quyết định đã chốt sơ bộ

| Khu vực | Công nghệ / quyết định |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Backend / Control Plane | NestJS + TypeScript + Fastify |
| API | REST + OpenAPI; SSE cho cập nhật một chiều theo thời gian thực |
| Phương pháp phát triển | Lean Spec-Driven; Contract-First theo từng vertical slice tại các integration boundary |
| Database | PostgreSQL + Prisma cho domain data |
| Job queue ban đầu | PostgreSQL-backed task queue + lease API qua HTTPS |
| GPU Worker | Python 3.11 + uv + PyTorch/CUDA |
| Asset Store | Cloudflare R2 qua S3-compatible API |
| Worker deployment | Hai Docker image: Batch Media Worker và Interactive TTS Worker |
| Container registry | GitHub Container Registry (GHCR) |
| VPS deployment | Docker Compose; reverse proxy/TLS bằng Caddy |
| CI/CD | GitHub Actions |
| TypeScript package manager | pnpm workspace |
| Python package manager | uv với lockfile riêng cho worker image |

### 2.1 Các quyết định chưa áp dụng ở giai đoạn đầu

- Không dùng Next.js vì đây là dashboard nội bộ, không cần SEO hoặc SSR.
- Không dùng GraphQL; REST/OpenAPI phù hợp hơn cho browser và Python Worker.
- Không dùng Kubernetes ở giai đoạn đầu.
- Không dùng BullMQ làm contract trực tiếp với Python Worker.
- Không dùng Celery/RQ làm orchestrator chính vì Control Plane được viết bằng NestJS.
- Chưa dùng RabbitMQ hoặc Temporal cho core pipeline; chỉ đánh giá lại khi quy mô và độ phức tạp thực tế yêu cầu.
- Redis không phải dependency bắt buộc ban đầu. Có thể bổ sung sau cho cache, rate limit hoặc pub/sub khi chạy nhiều API instance.
- Chưa dùng TypeSpec ở giai đoạn đầu; OpenAPI YAML đủ đơn giản cho MVP. Chỉ đánh giá lại khi contract lớn, lặp lại nhiều hoặc cần quản trị nhiều version.
- Không dùng Micro Frontend ở giai đoạn đầu. FE là một modular frontend monolith; chỉ đánh giá tách deploy khi có nhiều team FE độc lập và release cadence khác nhau.

## 3. Kiến trúc runtime tổng thể

```text
┌────────────────────────────── Trình duyệt ──────────────────────────────┐
│ React Web                                                               │
│ Dashboard · Discovery · Queue · Library · Review · Publishing           │
└───────────────────────────────┬──────────────────────────────────────────┘
                                │ REST + SSE
                                ▼
┌──────────────────────────── VPS 24/7 ────────────────────────────────────┐
│ NestJS Control Plane                                                    │
│ API · Auth · Workflow · Worker Registry · Content · Publishing          │
│                                                                         │
│ PostgreSQL                         Caddy                                 │
│ Domain data · tasks · leases       HTTPS/TLS                            │
└──────────────┬──────────────────────┬────────────────────────────────────┘
               │                      │ presigned GET/PUT
               │ HTTPS Worker API     ▼
               │              ┌──────────────────────┐
               │              │ Cloudflare R2        │
               │              │ video/audio/SRT/img  │
               │              └──────────┬───────────┘
               ▼                         │
┌──────────────────── GPU thuê theo giờ ─┴────────────────────────────────┐
│ Python GPU Worker Agent                                                 │
│                                                                         │
│ Batch Media Worker              Interactive TTS Worker                  │
│ VSR · OCR/ASR · Demucs          OmniVoice warm model                    │
│ FFmpeg/render                   preview · initial dub · re-gen segment  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Trust boundary

- Browser chỉ giao tiếp với NestJS và presigned URL có thời hạn.
- NestJS giữ database credential, R2 credential và quyền sinh presigned URL.
- GPU Worker không nhận database credential.
- GPU Worker chỉ kết nối outbound HTTPS đến Control Plane và R2.
- Broker hoặc PostgreSQL không được expose trực tiếp cho GPU Worker trên Internet.
- Bootstrap token chỉ dùng để enroll worker; sau đó đổi sang worker credential có phạm vi hẹp và có thể thu hồi.

## 4. Cấu trúc monorepo

```text
dubbing-studio/
├── apps/
│   ├── web/                         # React + Vite
│   └── api/                         # NestJS Control Plane
│
├── packages/
│   ├── ui/                          # Design tokens và component dùng chung
│   ├── api-contract/                # TypeScript types sinh từ OpenAPI
│   ├── api-client/                  # HTTP client dùng generated contract
│   ├── eslint-config/               # Quy tắc dùng chung cho TypeScript
│   └── tsconfig/                    # Base TypeScript configs
│
├── workers/
│   └── gpu/
│       ├── src/reup_worker/
│       │   ├── common/              # Agent, lease, R2, telemetry, subprocess
│       │   ├── batch_media/         # VSR, OCR/ASR, Demucs, render
│       │   └── interactive_tts/     # OmniVoice, cache, preview, batching
│       ├── tests/
│       ├── pyproject.toml
│       ├── uv.lock
│       └── docker/
│           ├── batch.Dockerfile
│           └── tts.Dockerfile
│
├── contracts/
│   ├── openapi/
│   │   ├── web.openapi.yaml         # Contract React ↔ Control Plane
│   │   └── worker.openapi.yaml      # Contract Control Plane ↔ GPU Worker
│   └── events/                      # Versioned JSON schemas nếu cần
│
├── infra/
│   ├── compose/                     # Local và VPS Docker Compose
│   ├── caddy/                       # TLS/reverse proxy
│   └── scripts/                     # Bootstrap, backup, worker enrollment
│
├── docs/
└── package.json                     # pnpm workspace root
```

### 4.1 Quy tắc dependency

- `apps/web` không import code nội bộ từ `apps/api`.
- `contracts/openapi` là nguồn chuẩn cho contract ở integration boundary; generated file không được sửa tay.
- `packages/api-contract` chứa type được generate và có thể được dùng bởi cả adapter HTTP của NestJS lẫn React.
- `packages/api-client` dùng generated contract để cung cấp typed HTTP client; không định nghĩa lại request/response interface.
- Python không import TypeScript package; worker giao tiếp bằng HTTP và JSON contract có version.
- `packages/ui` không chứa domain logic.
- Batch Media và Interactive TTS dùng chung phần agent/protocol nhưng có entrypoint và Docker image độc lập.
- Mọi tool AI/media được pin theo worker image digest; không cài dependency động khi worker đang chạy production.

## 5. Frontend architecture

### 5.1 Stack

- React + TypeScript.
- Vite cho dev server và production build.
- React Router cho navigation.
- TanStack Query cho server state, cache và invalidation.
- Zustand chỉ cho UI/editor state phức tạp trong Library/Review Studio.
- React Hook Form + Zod cho form và validation phía client.
- Tailwind CSS kết hợp CSS variables/design tokens từ UI prototype.
- Radix UI hoặc shadcn primitives cho accessibility; giao diện phải được restyle theo prototype, không dùng theme mặc định.
- Vitest + Testing Library; Playwright cho critical user flows.

### 5.2 State boundaries

| Loại state | Nơi sở hữu |
|---|---|
| Video, job, task, worker, channel profile | Backend + TanStack Query cache |
| Playback, segment đang chọn, panel đang mở | Local component/Zustand |
| Draft câu dịch hoặc cast chưa lưu | Zustand/form state có dirty tracking |
| Workflow status chuẩn | PostgreSQL; frontend không tự suy diễn để ghi ngược |
| Progress realtime | SSE event, sau đó reconcile bằng API query |

### 5.3 Realtime

SSE được dùng cho:

- trạng thái job/task;
- worker heartbeat và capacity;
- tiến độ xử lý;
- thông báo preview audio đã sẵn sàng;
- cảnh báo worker idle hoặc mất heartbeat.

SSE chỉ là kênh thông báo. Sau reconnect, frontend phải refetch REST API; không coi event stream là nguồn dữ liệu duy nhất.

WebSocket chỉ được bổ sung nếu sau này cần điều khiển hai chiều liên tục mà REST + SSE không đáp ứng được.

### 5.4 Hình thức tổ chức FE

FE dùng feature-first modular architecture, không áp dụng Hexagonal một cách máy móc cho component tree:

```text
app
 ↓
routes
 ↓
features
 ↓
entities
 ↓
shared
```

Layer phía dưới không import ngược lên layer phía trên. Route là composition boundary; business action nằm trong feature; domain presentation nằm trong entity; code không biết nghiệp vụ nằm trong shared.

### 5.5 Cấu trúc thư mục

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── providers/                 # Query, auth, router, error boundary
│   │   ├── router/                    # Route table và path constants
│   │   ├── layouts/                   # App shell, sidebar, header
│   │   ├── styles/                    # Global CSS và design tokens
│   │   └── app.tsx
│   │
│   ├── routes/
│   │   ├── overview/
│   │   ├── discovery/
│   │   ├── queue/
│   │   ├── library/
│   │   ├── publishing/
│   │   ├── workers/
│   │   ├── channel-profiles/
│   │   ├── voice-library/
│   │   └── settings/
│   │
│   ├── features/
│   │   ├── create-video-job/
│   │   ├── select-source-video/
│   │   ├── retry-pipeline-task/
│   │   ├── edit-translation/
│   │   ├── assign-cast/
│   │   ├── regenerate-voice/
│   │   ├── approve-video/
│   │   ├── update-review-policy/
│   │   ├── prepare-publish-package/
│   │   ├── record-manual-publish/
│   │   └── enroll-worker/
│   │
│   ├── entities/
│   │   ├── video/
│   │   ├── pipeline-job/
│   │   ├── pipeline-task/
│   │   ├── worker/
│   │   ├── voice-profile/
│   │   ├── channel-profile/
│   │   ├── publish-package/
│   │   └── review-decision/
│   │
│   ├── shared/
│   │   ├── api/                       # Configured API client và auth middleware
│   │   ├── config/                    # Typed environment/config
│   │   ├── hooks/                     # Hook không biết domain
│   │   ├── lib/                       # Formatter/helper không biết domain
│   │   ├── ui/                        # App-specific generic UI composition
│   │   └── assets/
│   │
│   ├── test/
│   │   ├── msw/                       # Browser/server và mock handlers
│   │   ├── fixtures/
│   │   └── test-utils.tsx
│   │
│   └── main.tsx
│
├── e2e/                               # Playwright vertical-slice tests
├── public/
└── vite.config.ts
```

Không tạo sẵn mọi thư mục con. Chỉ thêm `api`, `model`, `ui` hoặc `lib` trong một module khi có file thực tế.

### 5.6 Trách nhiệm từng layer

| Layer | Trách nhiệm | Không được chứa |
|---|---|---|
| `app` | Bootstrap, provider, global layout, router và global error boundary | Nghiệp vụ video/job |
| `routes` | Ghép feature/entity thành màn hình, đọc URL params, route loading/error | Business logic tái sử dụng |
| `features` | Một hành động người dùng hoặc use case | App shell hoặc generic primitive |
| `entities` | Hiển thị/query logic tái sử dụng theo domain noun | Workflow điều phối nhiều use case |
| `shared` | API bootstrap, generic UI, config, formatter, utility | Kiến thức về video, worker, voice hoặc publishing |

Feature dùng động từ/use case như `create-video-job`; entity dùng danh từ nghiệp vụ như `video` hoặc `worker`.

### 5.7 Cấu trúc một feature/entity

```text
features/create-video-job/
├── api/
│   └── create-video-job.mutation.ts
├── model/
│   ├── create-video-job.schema.ts
│   └── create-video-job.mapper.ts
├── ui/
│   └── create-video-job-form.tsx
├── lib/
└── index.ts
```

- `api`: TanStack Query options/hooks gọi typed API client.
- `model`: form schema, view state, mapper và local business rule của feature.
- `ui`: component thuộc feature.
- `lib`: helper chỉ phục vụ module đó.
- `index.ts`: public API duy nhất của module.

Không deep-import file nội bộ từ module khác. Nếu hai feature cần cùng logic, ưu tiên compose ở route hoặc trích phần domain chung xuống entity; không tạo dependency vòng giữa các feature.

### 5.8 API và type trong FE

```text
contracts/openapi/web.openapi.yaml
             ↓
packages/api-contract
             ↓
packages/api-client
             ↓
apps/web/src/shared/api
             ↓
entities/features
```

- `packages/api-contract` chứa request/response types được generate.
- `packages/api-client` chứa typed HTTP client, không chứa UI component.
- `apps/web/src/shared/api` cấu hình base URL, auth, error normalization và React Query integration.
- Entity thường sở hữu query dùng lại; feature thường sở hữu mutation của use case.
- Không khai báo lại API response type trong `apps/web`.
- Form state được phép có schema riêng vì shape của form có thể khác wire contract; mapper phải chuyển form value thành request contract một cách tường minh.

### 5.9 Route mapping theo UI đã duyệt

```text
/                         → Tổng quan
/discovery                → Khám phá video
/queue                    → Hàng đợi xử lý
/library                  → Thư viện video
/library/:videoId         → Chi tiết, review và chỉnh sửa video
/publishing               → Bàn đăng bài
/workers                  → GPU Workers
/channel-profiles         → Hồ sơ kênh
/voices                   → Thư viện giọng
/settings                 → Cài đặt
```

Review Studio không phải menu độc lập; nó là capability của màn hình chi tiết video trong Thư viện.

### 5.10 Testing boundary

- Component/unit test đặt cạnh module sở hữu code.
- MSW handler dùng OpenAPI example để FE chạy độc lập trước khi BE hoàn thành.
- Contract/typecheck phát hiện FE bị lệch API sau khi regenerate.
- Playwright kiểm tra theo vertical slice như tạo job, review video và xác nhận đăng thủ công.
- Storybook không phải dependency bắt buộc ban đầu; chỉ bổ sung nếu design system/component review thực tế cần.

### 5.11 Khả năng mở rộng

Kiến trúc hiện tại được chốt cho React + Vite. Nếu sau này có lý do rõ ràng để dùng Next.js, phần lớn feature, entity, contract và domain-independent utility có thể giữ lại; phần app bootstrap, router và data-loading integration sẽ thay đổi.

Không tối ưu trước cho Vue hoặc Micro Frontend. Route và feature boundary được giữ rõ để có thể tách dần trong tương lai, nhưng deployment ban đầu vẫn là một FE application.

## 6. NestJS Control Plane

### 6.1 Hình thức triển khai

Backend bắt đầu dưới dạng modular monolith, một deployable chính nhưng chia module rõ ràng:

```text
AuthModule
DiscoveryModule
VideosModule
WorkflowModule
TasksModule
WorkersModule
VoiceProfilesModule
ReviewModule
PublishingModule
StorageModule
NotificationsModule
AuditModule
```

Không tách các module này thành network microservice trước khi có nhu cầu scale hoặc ownership thực tế.

### 6.2 Trách nhiệm

- Xác thực người dùng và worker.
- Quản lý video, channel profile, voice profile, cast sheet và publish package.
- Xác thực mọi workflow transition.
- Tạo task theo dependency graph.
- Cấp, gia hạn và thu hồi task lease.
- Sinh presigned URL cho R2.
- Ghi audit event và worker cost snapshot.
- Phát SSE event cho frontend.
- Không chạy trực tiếp model AI hoặc xử lý video nặng.

### 6.3 API contract

- REST JSON là contract chính.
- OpenAPI trong `contracts/openapi` là nguồn contract chuẩn và được thiết kế trước implementation theo từng feature nhỏ.
- TypeScript type trong `packages/api-contract` và web client trong `packages/api-client` được generate từ OpenAPI.
- NestJS HTTP DTO là implementation của contract, không phải nguồn type độc lập; DTO bổ sung runtime validation nhưng phải khớp generated contract.
- Python Worker dùng Pydantic model/client được generate hoặc adapter được kiểm tra tương thích với `worker.openapi.yaml`.
- Payload thay đổi không tương thích phải tăng `contract_version`.
- Queue payload chỉ chứa ID, object key, metadata và checksum; không chứa binary asset.

## 7. Contract-First và phát triển song song

### 7.1 Cách tiếp cận đã chọn

Tên đầy đủ của cách làm trong dự án là:

```text
Lean Spec-Driven Development
+ Contract-First tại integration boundary
+ Vertical Slice Delivery
+ Code-First cho implementation nội bộ
```

`Schema-First` có thể được dùng theo nghĩa rộng, nhưng không dùng làm tên chính vì dễ bị nhầm với database schema hoặc GraphQL schema. Dự án không thiết kế toàn bộ hệ thống theo waterfall trước khi viết code.

Contract-First áp dụng cho:

- React ↔ NestJS;
- NestJS ↔ Python GPU Worker;
- SSE event và worker heartbeat/progress event;
- task payload, callback, webhook và artifact metadata;
- các interface có nhiều consumer hoặc vượt qua process/language boundary.

Không yêu cầu Contract-First cho:

- domain entity, application service và repository nội bộ;
- Prisma model và database table;
- React component hoặc local UI state;
- helper function và chi tiết gọi model bên trong Worker;
- implementation không đi qua integration boundary.

### 7.2 Đơn vị phát triển

Không viết toàn bộ OpenAPI của sản phẩm ngay từ đầu. Mỗi feature được chia thành một vertical slice đủ nhỏ, ví dụ:

```text
Tạo video job
→ theo dõi pipeline
→ duyệt bản dịch/cast/voice
→ render output
→ tạo publish package
```

Trước khi FE, BE và Worker triển khai một slice, team chỉ cần chốt:

1. mục tiêu người dùng và acceptance criteria;
2. state transition liên quan;
3. request, response, error và event contract;
4. ít nhất một example cho happy path và error quan trọng;
5. quy tắc compatibility của thay đổi.

Contract của một slice phải nhỏ, review được trong một pull request và không khóa những phần sản phẩm chưa được khám phá.

### 7.3 Luồng làm việc song song

```text
Feature brief + acceptance criteria
                │
                ▼
       Draft OpenAPI / event schema
                │
       Review FE + BE + Worker
                │
                ▼
     Generate types, client, examples
                │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
 FE + mock API   BE implementation   Worker implementation
        └────────────┼────────────┘
                     ▼
       Contract test + integration test
                     ▼
             E2E theo vertical slice
```

- FE dùng response example để chạy mock ngay sau khi contract được duyệt; không chờ database hoặc API implementation.
- BE thiết kế domain và database phía sau contract, đồng thời triển khai controller/DTO khớp schema.
- Worker chỉ bắt đầu task liên quan khi internal contract đã duyệt; fake worker được dùng cho integration test trước khi có GPU thật.
- Khi API thật sẵn sàng, FE đổi từ mock endpoint sang real endpoint mà không thay request/response type.

### 7.4 Vòng đời contract

Mỗi thay đổi contract đi qua các trạng thái:

```text
DRAFT → REVIEWED → APPROVED → IMPLEMENTING → VERIFIED
```

- `DRAFT`: còn được phép đổi nhanh theo khám phá UX/nghiệp vụ.
- `REVIEWED`: FE, BE và consumer liên quan đã kiểm tra tính khả thi.
- `APPROVED`: được phép generate client và chia task song song.
- `IMPLEMENTING`: implementation không tự ý đổi shape ngoài contract.
- `VERIFIED`: provider, consumer và E2E test đã vượt qua.

Trước khi release, thay đổi breaking có thể được phối hợp trong cùng pull request và regenerate tất cả consumer. Sau khi contract đã được deploy hoặc có consumer độc lập, breaking change phải dùng version mới hoặc có giai đoạn backward compatibility.

### 7.5 Automation và CI gate

Workspace cung cấp các command chuẩn, tên cuối cùng sẽ được chốt khi scaffold:

```text
pnpm contract:lint       # kiểm tra OpenAPI/schema hợp lệ
pnpm contract:generate   # generate TS types và API client
pnpm contract:check      # phát hiện generated artifact hoặc implementation bị drift
pnpm typecheck           # kiểm tra FE/BE TypeScript
pnpm test:contract       # provider/consumer compatibility
pnpm test:e2e            # happy path của vertical slice
```

Generated artifact được tạo deterministically và không sửa bằng tay. CI phải thất bại khi:

- OpenAPI không hợp lệ;
- generated type/client chưa được cập nhật;
- endpoint implementation lệch request/response đã duyệt;
- có breaking change ngoài quy tắc versioning;
- example không còn hợp lệ với schema;
- FE hoặc BE không còn typecheck sau khi regenerate.

### 7.6 Cách dùng AI trong quy trình

Con người chịu trách nhiệm chốt mục tiêu, nghiệp vụ, state transition, compatibility và duyệt contract. Coding agent được dùng để:

- đề xuất/refine OpenAPI từ acceptance criteria;
- generate client, mock, DTO skeleton và test;
- triển khai các vertical slice độc lập;
- phát hiện drift giữa spec, code và test;
- cập nhật tài liệu và example cùng pull request.

Không giao cho agent một prompt lớn để tự thiết kế và triển khai toàn bộ hệ thống trong một lần. Contract sai có thể làm nhiều agent sinh ra lượng lớn code sai rất nhanh; vì vậy mỗi slice phải có review gate trước khi fan-out công việc.

### 7.7 Nguồn sự thật theo lớp

| Phạm vi | Nguồn sự thật |
|---|---|
| Hành vi sản phẩm | Feature spec + acceptance criteria |
| HTTP/event boundary | OpenAPI hoặc versioned event schema |
| Domain rule | Domain model/use case test trong NestJS |
| Persistence | Prisma schema + migration |
| Runtime workflow state | PostgreSQL |
| UI server state | Backend API; TanStack Query chỉ là cache |
| Generated TypeScript | OpenAPI; generated file không sửa tay |

## 8. PostgreSQL và mô hình workflow

PostgreSQL là nguồn dữ liệu chuẩn cho domain state và task state. Prisma dùng cho phần lớn CRUD và transaction nghiệp vụ; một repository SQL chuyên biệt được phép dùng cho thao tác atomic lease.

### 8.1 Các aggregate/bảng khái niệm

Tên cuối cùng sẽ được chốt khi thiết kế schema:

```text
videos
video_assets
pipeline_jobs
pipeline_tasks
task_dependencies
task_attempts
task_leases
workers
worker_sessions
worker_cost_snapshots
workflow_events
review_decisions
voice_profiles
cast_sheets
publish_packages
```

### 8.2 Job và task

Một `pipeline_job` đại diện cho mục tiêu xử lý một video. Mỗi job gồm nhiều `pipeline_task` nhỏ hơn:

```text
DOWNLOAD
DESUB
TRANSCRIBE
TRANSLATE
GENERATE_INITIAL_TTS
WAIT_FOR_REVIEW
REGENERATE_SEGMENT
SEPARATE_AUDIO
RENDER
EXPORT_SRT
UPLOAD_OUTPUTS
GENERATE_PUBLISH_PACKAGE
```

Task là đơn vị được worker lease. Không giao nguyên video job độc quyền cho một GPU Worker trong toàn bộ vòng đời, vì các stage cần loại tài nguyên khác nhau và có bước chờ người dùng.

### 8.3 Resource class

Mỗi task khai báo một resource class:

```text
IO
CPU
GPU_BATCH
GPU_TTS_INTERACTIVE
CONTROL_PLANE
HUMAN_REVIEW
```

Task chỉ được cấp cho worker có capability và slot tương ứng.

### 8.4 Lease nguyên tắc

1. Worker gửi capacity trong heartbeat.
2. Worker yêu cầu task phù hợp với role và slot còn trống.
3. Control Plane chọn task sẵn sàng bằng transaction atomic.
4. Lease có deadline, attempt number và idempotency key.
5. Worker gia hạn lease trong lúc chạy và gửi progress.
6. Hoàn tất task chỉ được ghi nhận khi output cần thiết đã upload và checksum hợp lệ.
7. Nếu worker mất heartbeat hoặc lease hết hạn, task được đánh giá để retry; không tự động chạy trùng khi attempt cũ vẫn có khả năng ghi output.

Chi tiết timeout, retry và fencing token là `TBD` cho vòng phân tích tiếp theo.

## 9. GPU Worker architecture

### 9.1 Worker Agent chung

Mỗi worker image có một agent chịu trách nhiệm:

- enroll bằng bootstrap token;
- phát hiện GPU/VRAM/driver bằng `nvidia-smi`;
- gửi heartbeat và capacity;
- lease/renew/complete/fail task;
- download/upload asset qua R2;
- chạy task trong child process để có thể cancel và thu log;
- quản lý workspace cục bộ và cleanup;
- ghi peak VRAM, GPU time, wall time, exit code và image digest;
- drain an toàn trước khi người dùng xóa container.

### 9.2 Batch Media Worker

Chứa các task media nặng:

- video-subtitle-remover;
- OCR/ASR;
- Demucs;
- ffmpeg/ffprobe;
- final render và export.

Worker có thể giữ nhiều task I/O/CPU đồng thời, nhưng mặc định chỉ chạy một task GPU-heavy trên mỗi GPU vật lý.

### 9.3 Interactive TTS Worker

Chứa OmniVoice và được tối ưu cho latency:

- model được load một lần và giữ nóng;
- voice clone prompt được cache;
- preview/re-gen từ phiên edit có priority cao;
- initial dub được phép batch segment để tăng throughput;
- không load nhiều bản model trên cùng GPU nếu chưa benchmark chứng minh có lợi.

Batch size và FlashInfer/CUDA Graph support phải được benchmark theo GPU model và image version, không lấy số H100 áp trực tiếp cho RTX 3060/V100.

## 10. Resource-aware concurrency

### 10.1 Mục tiêu

Không tối ưu số job chạy đồng thời một cách độc lập. Chỉ số chính là:

```text
completed_videos_per_gpu_hour
cost_per_video = hourly_rate × rented_hours / completed_videos
```

Các guardrail đi kèm:

- không OOM;
- không làm preview vượt latency mục tiêu;
- không tạo retry do tài nguyên;
- chừa khoảng VRAM an toàn;
- output phải deterministic/idempotent theo attempt.

### 10.2 Concurrency mặc định ban đầu

| Tác vụ | Mức khởi đầu |
|---|---:|
| Download/upload R2 | 2–4 task/worker |
| Metadata/ffprobe/preprocess CPU | 2–4 task/worker, tùy CPU/RAM |
| VSR/inpainting | 1 task/GPU |
| OCR/ASR GPU | 1 task/GPU |
| Demucs GPU | 1 task/GPU |
| GPU render nếu có | 1 task/GPU |
| Interactive preview | batch 1, priority cao |
| Initial TTS | thử batch 1 → 2 → 4 → 8 sau benchmark |

Các số trên là safe default, không phải cấu hình production cuối cùng.

### 10.3 Pipeline overlap

Một worker vẫn có thể làm nhiều video cùng lúc theo loại tài nguyên:

```text
Video A: chạy VSR trên GPU
Video B: download/preprocess bằng CPU và network
Video C: upload output lên R2
```

Khi GPU task của A kết thúc, GPU slot nhận task sẵn sàng của B ngay cả khi upload của A vẫn tiếp tục.

### 10.4 Multi-GPU

- Mỗi GPU vật lý cung cấp tối thiểu một GPU execution slot.
- Worker supervisor spawn process riêng và pin `CUDA_VISIBLE_DEVICES`.
- Máy `2× GPU` có thể chạy hai task GPU-heavy độc lập, mỗi task trên một GPU.
- Không giả định VRAM có thể cộng gộp giữa hai GPU trừ khi tool cụ thể hỗ trợ distributed inference và đã được benchmark.

### 10.5 Performance profile

App lưu performance profile theo tổ hợp:

```text
provider
gpu_model
gpu_count
worker_role
worker_image_digest
pipeline_stage
model_version
video_resolution_bucket
batch_size/concurrency
peak_vram
wall_time
gpu_active_time
throughput
failure_rate
```

Control Plane dùng profile đã duyệt để đề xuất capacity, không hard-code concurrency theo tên GPU trong source code.

### 10.6 Tối ưu phiên thuê GPU

1. Gom sẵn nhiều task GPU vào queue trước khi bật Batch Worker.
2. Load model một lần và xử lý nhiều video liên tiếp.
3. Prefetch input của task kế tiếp.
4. Chồng lấp upload/CPU work với GPU work.
5. Khi hết task phù hợp, worker chuyển sang `DRAINING` hoặc `IDLE`.
6. Sau idle TTL, Control Plane hiển thị `SAFE_TO_TERMINATE`.
7. Với EzyCloudX manual mode, người dùng vẫn phải xóa container trên dashboard để dừng tính phí.

## 11. Asset Store

Cloudflare R2 lưu các asset lớn và artifact của pipeline:

```text
sources/{video_id}/...
intermediate/{video_id}/{pipeline_version}/...
previews/{video_id}/{revision}/...
outputs/{video_id}/{revision}/...
voices/{voice_profile_id}/...
```

Nguyên tắc:

- Database lưu metadata, object key, checksum, content type, size và revision.
- Browser/worker nhận presigned URL có thời hạn ngắn.
- Secret R2 không được gửi cho browser.
- Task chỉ complete sau khi HEAD/checksum xác nhận output tồn tại.
- Lifecycle/retention cho intermediate asset là `TBD`.
- MP4 thành phẩm và `.srt` dùng cùng basename theo đặc tả sản phẩm.

## 12. Deployment topology

### 12.1 VPS

Docker Compose ban đầu gồm:

```text
caddy
web
api
postgres
```

Redis chỉ được thêm khi có use case đo được. Backup PostgreSQL được đẩy sang R2 theo lịch.

### 12.2 GPU

GitHub Actions build và push:

```text
ghcr.io/<owner>/reup-dubbing-media-worker:<version>
ghcr.io/<owner>/reup-dubbing-tts-worker:<version>
```

Mỗi worker đăng ký cả semantic version và immutable image digest. Control Plane không giao task cho image version chưa được duyệt.

### 12.3 Local development

- React và NestJS chạy local bằng pnpm scripts.
- PostgreSQL chạy Docker Compose.
- R2 có thể dùng bucket dev riêng hoặc MinIO adapter trong local test.
- GPU tasks có fake worker cho contract/integration test.
- Test GPU thật chạy riêng trên image và hardware mục tiêu; không giả lập benchmark GPU bằng Mac CPU/MPS.

## 13. Observability và đo chi phí

Mỗi task attempt ghi:

- queue wait time;
- download/upload time;
- model load/warmup time;
- execution wall time;
- GPU active time nếu đo được;
- peak VRAM;
- input/output size;
- worker và image digest;
- error category;
- retry reason.

Chi phí hiển thị trong app là ước tính:

```text
estimated_session_cost = configured_hourly_rate × worker_session_duration
estimated_cost_per_video = allocated_session_cost / completed_video_count
```

Đơn giá là snapshot do người dùng nhập khi tạo worker record, không phải hóa đơn trực tiếp từ EzyCloudX.

## 14. Testing strategy sơ bộ

| Lớp | Kiểm tra |
|---|---|
| React | component, accessibility, query states, Playwright critical flows |
| NestJS domain | state transition, authorization, idempotency, lease transaction |
| API contract | lint schema, generated artifact drift, provider/consumer compatibility và breaking-change check |
| Python common | protocol, retry, checksum, workspace cleanup, subprocess control |
| Media task | golden fixture nhỏ; integration test theo tool version |
| GPU acceptance | benchmark trên đúng GPU/image; peak VRAM và quality gate |
| End-to-end | fake worker trước, GPU worker thật cho release candidate |

## 15. Những phần cần phân tích sâu tiếp theo

Các vòng thiết kế tiếp theo nên đi theo thứ tự:

1. **Domain model và state machine:** job/task/review/render/publish transitions.
2. **Worker protocol:** enroll, auth, heartbeat, lease, fencing token, cancel và drain.
3. **Retry/idempotency:** output key, attempt ownership và xử lý worker sống lại muộn.
4. **Concurrency benchmark plan:** matrix GPU × stage × resolution × batch size.
5. **Database schema:** index, constraint, audit/event model và transaction boundary.
6. **API inventory chi tiết:** browser API, internal worker API và SSE event envelope theo từng vertical slice.
7. **R2 layout/lifecycle:** revision, checksum, retention và multipart upload.
8. **NestJS module boundaries:** dependency direction và background scheduler.
9. **Studio preview:** audio revision, segment re-gen, priority và latency budget.
10. **Deployment/security:** secrets, backup/restore, worker token rotation và network policy.

## 16. Nguồn tham khảo chính thức

- [React versions](https://react.dev/versions)
- [Vite getting started](https://vite.dev/guide/)
- [NestJS Fastify](https://docs.nestjs.com/techniques/performance)
- [NestJS Server-Sent Events](https://docs.nestjs.com/techniques/server-sent-events)
- [NestJS Prisma recipe](https://docs.nestjs.com/recipes/prisma)
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction)
- [OpenAPI TypeScript](https://openapi-ts.dev/introduction)
- [OpenAPI Fetch](https://openapi-ts.dev/openapi-fetch/)
- [OpenAPI React Query](https://openapi-ts.dev/openapi-react-query/)
- [GitHub Spec Kit — Spec-Driven Development](https://github.github.com/spec-kit/)
- [Pact — Consumer Driven Contracts](https://docs.pact.io/)
- [TypeSpec overview](https://learn.microsoft.com/en-us/azure/developer/typespec/overview)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [OmniVoice](https://github.com/k2-fsa/OmniVoice)
- [Temporal TypeScript SDK guide](https://docs.temporal.io/develop/typescript)
- [Temporal Python SDK guide](https://docs.temporal.io/develop/python)
- [Temporal self-hosted deployment](https://docs.temporal.io/self-hosted-guide/deployment)
