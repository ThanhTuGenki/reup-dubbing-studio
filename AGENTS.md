# Reup Dubbing Studio — Agent Context

- **Trạng thái:** `ACTIVE`.
- **Cập nhật:** 2026-09-19.
- **Nguồn chuẩn cho:** cách agent sử dụng OpenDesign export cục bộ khi triển khai
  hoặc review UI trong repository này.
- **Không phải nguồn chuẩn cho:** phạm vi sản phẩm, database, API contract hoặc
  hành vi pipeline.

## OpenDesign source

Design system đã export từ OpenDesign được đặt cục bộ tại:

```text
Project-As-Complete-Opendesign-Design-System/
```

Thư mục này bị Git ignore có chủ đích vì là gói export cục bộ 117 file, khoảng
3.6 MB. Không force-add thư mục vào Git. Nếu thư mục không tồn tại trên máy đang
chạy, dùng các prototype đã commit tại `docs/reference/ui-prototype/` và báo rõ
rằng không thể thực hiện visual comparison với full export.

Metadata để đối chiếu đúng project:

```text
Source OpenDesign project: Dashboard Reup Dubbing Studio
Source project id: b1501f80-71ed-43e1-9b1b-a7b024624ef9
Design-system project id: aac239b1-6f7c-4e04-98a3-fe026bf06444
Design-system id: user:dashboard-reup-dubbing-studio-design-system
```

## Quy trình bắt buộc cho task UI

Khi tạo, sửa hoặc review UI:

1. Đọc `Project-As-Complete-Opendesign-Design-System/SKILL.md`.
2. Đọc `Project-As-Complete-Opendesign-Design-System/DESIGN.md` để lấy token,
   typography, spacing, component anatomy, motion, copy và anti-pattern.
3. Đọc `DESIGN-MANIFEST.json` và màn hình tương ứng trong
   `docs/ui-prototype/`; không suy thiết kế chỉ từ một screenshot.
4. Ánh xạ `tokens.css` và `colors_and_type.css` vào theme của stack hiện hành,
   đồng thời tái sử dụng SVG trong `assets/`. `ui_kits/app/components/` chỉ là
   bằng chứng về anatomy/interaction; không copy HTML hoặc JSX của export vào
   production và không dùng nó thay component library của dự án.
5. So sánh kết quả với preview/source screen liên quan ở các viewport được ghi
   trong manifest trước khi kết luận hoàn tất.

Không cần khởi tạo một OpenDesign generation workflow chỉ để đọc các file export
đã có trên disk. Chỉ dùng OpenDesign workflow khi người dùng yêu cầu tạo hoặc sửa
artifact trong OpenDesign.

## Design-to-technology adapter

OpenDesign là visual contract độc lập công nghệ, không phải source component để
copy nguyên HTML vào production. Khi triển khai UI, chuyển token và interaction
contract sang stack hiện hành:

1. Với React web hiện tại, dùng shadcn làm component source mặc định. Consumer
   import component shadcn cục bộ; không tự viết lại primitive đã có trong
   registry.
2. Nhiều component shadcn dùng Radix bên dưới. Chỉ import Radix trực tiếp khi
   registry shadcn không có primitive/behavior cần thiết.
3. Dùng Tailwind theme/CSS variables làm adapter cho color, typography, spacing,
   radius, elevation, motion và layout token từ OpenDesign. Không giữ palette
   hoặc radius mặc định của shadcn.
4. Chỉ custom component/composition riêng của sản phẩm sau khi đã ghép từ
   primitive shadcn; custom phải truy vết về visual/state trong OpenDesign.
5. Nếu một dự án khác dùng MUI, native app hoặc công nghệ khác, giữ nguyên visual
   contract và ánh xạ token/component role sang theme API của công nghệ đó; không
   bắt dự án khác mang theo Tailwind/shadcn.

Các tài liệu 004 cũ mô tả một public package/catalog riêng và không còn là flow
triển khai hiện hành. Không dùng chúng để override quy tắc shadcn-first ở trên.

## Thứ tự ưu tiên nguồn chuẩn

Khi tài liệu mâu thuẫn, áp dụng theo phạm vi thay vì chọn một nguồn cho mọi thứ:

1. Product behavior và scope: `docs/product/design.md`.
2. Kiến trúc/runtime/data: `docs/architecture/`.
3. Web–API–worker contract: `contracts/openapi/` sau khi contract được verified.
4. Visual language, geometry và interaction pattern: OpenDesign export.
5. Prototype đã archive: `docs/reference/ui-prototype/`, chỉ làm evidence.

OpenDesign export không được tự mở rộng scope sản phẩm. Giữ visual pattern nhưng
bỏ hoặc điều chỉnh prototype-only behavior khi product/architecture docs đã chốt
khác.

## Visual baseline

- Canvas off-white `#F5F8F4`, surface trắng, sidebar `#F2F7F2`.
- Text chính `#1F2D22`; accent sage duy nhất với strong `#397246`, accent
  `#4F8A59`, soft `#DDEDE0`.
- Inter Variable cho UI; Berkeley Mono chỉ cho ID và timestamp.
- Grid spacing 8 px; control cao 44 px; sidebar 248/80 px; topbar 64 px;
  content tối đa 1600 px.
- Radius 6 px cho control, 12 px cho card/dialog; ưu tiên border, shadow nhẹ.
- UI copy bằng tiếng Việt, sentence case, động từ đứng trước; ghi “Dữ liệu mẫu”
  cho sample data.
- Một primary action trên mỗi màn hình; giữ đầy đủ hover, focus, pressed,
  disabled, loading, empty, error và success states.
- Tái sử dụng SVG export; không vẽ lại brand mark hoặc icon nếu asset đã có.

## Known export caveats

Các điểm sau đã được kiểm tra ngày 2026-09-19 và phải được nhớ khi dùng export:

1. `ui_kits/app/index.html` tham chiếu
   `vendor/react-with-dom.development.js`, nhưng bundle này không có trong export.
   Static snapshot xem được; interaction React không được coi là đã verify cho
   tới khi dependency được thay bằng dependency của app hoặc bundle hợp lệ.
2. `DESIGN.md`, `README.md` và source design notes còn mô tả Douyin Discovery
   bằng yt-dlp. Đây là thông tin cũ. Listing Douyin dùng browser adapter theo
   `docs/architecture/douyin-discovery.md`; yt-dlp không list trang tác giả.
3. Prototype có notification center/read-unread. MVP hiện chỉ dùng toast/SSE
   transient và không có bảng `notifications`; xem database decision `DB-09`.
4. `colors_and_type.css` import Inter từ Google Fonts. Production cần dùng font
   dependency hoặc self-host nếu không cho phép runtime network dependency.
5. Bốn file trong `source_examples/` là bản evidence độc lập nên link điều hướng
   tới tám màn hình không được copy sẽ không hoạt động. Dùng bản đầy đủ trong
   `docs/ui-prototype/` để test navigation.

## Quality boundary

OpenDesign export hiện có đủ manifest path và 12 prototype chính đã pass kiểm tra
JavaScript/tag balance. Điều đó không thay thế visual regression, accessibility,
responsive và production integration tests của `apps/web`.

## API contract source of truth

`contracts/openapi/*.yaml` là nguồn chuẩn duy nhất cho mọi wire model giữa Web
và API. Mỗi endpoint mới phải khai báo request/response schema đầy đủ trong
OpenAPI trước khi consumer được triển khai; chạy `pnpm contract:generate` để
generate `packages/api-contract/src/generated` và chỉ import type/client từ
`packages/api-client` trong Web/API. Không viết lại response schema bằng Zod,
TypeScript interface hoặc object type riêng theo từng feature. Runtime parsing
nếu cần chỉ được bổ sung khi có lý do bảo mật/không tin cậy cụ thể và phải bám
theo generated contract, không tạo một model thứ hai. Generated files không được
sửa tay. Khi contract thay đổi, regenerate và commit đồng thời OpenAPI,
generated artifacts, consumer tests và implementation liên quan.
