# Reup Dubbing Studio — Dashboard Prototype

## Mục tiêu

Prototype tập trung vào Application Shell và hai màn hình vận hành của Reup Dubbing Studio: Tổng quan và Khám phá video. Giao diện giúp người dùng theo dõi pipeline, kiểm tra metadata nguồn và chủ động chọn video trước khi tải.

## Phạm vi

- Desktop-first ở 1440px, responsive xuống tablet và mobile.
- Chỉ có dữ liệu mẫu, không kết nối backend và không thay đổi tài liệu thiết kế nguồn.
- Điều hướng thể hiện đầy đủ 9 mô-đun của sản phẩm; hai màn hình được triển khai chi tiết là **Tổng quan** (`index.html`) và **Khám phá video** (`discovery.html`).
- Các tương tác phục vụ review: thu gọn/mở sidebar, command palette, bộ lọc metadata, chọn nhiều video, bulk actions, loading/empty/error states, drawer chi tiết, cookie health và điều khiển watchlist.

## Cấu trúc màn hình

1. **Application shell:** sidebar có trạng thái worker, điều hướng chính và tài khoản; topbar có breadcrumb, tìm kiếm, thông báo.
2. **Dải KPI:** job đang chạy, job chờ GPU, video cần duyệt và video sẵn sàng đăng.
3. **Vận hành:** phân bổ video theo trạng thái và bảng các việc cần xử lý.
4. **Hạ tầng:** worker EzyCloudX, mức sử dụng, thời gian nhàn rỗi và tín hiệu có thể tắt an toàn.
5. **Chi phí:** chi phí GPU 7 ngày, số giờ GPU, chi phí/video và ngân sách tháng.
6. **Theo dõi:** cảnh báo có mức độ ưu tiên và dòng hoạt động gần đây.
7. **Khám phá video:** nhập nguồn, cookie health, bộ lọc metadata, bảng chọn video, bulk actions, drawer chi tiết và watchlist.

## Quy tắc khám phá nguồn

- Chỉ thu metadata Douyin/Bilibili bằng yt-dlp và cookie do người dùng cung cấp; prototype không tuyên bố có API nền tảng.
- Không tự tải video sau khi quét. Checkbox chỉ là lựa chọn tạm thời; video chỉ tạo ingest job sau modal “Xác nhận tạo job tải”, và bước này chưa bắt đầu xử lý GPU.
- Kiểm tra trùng dựa trên cặp `source platform + source video ID` trước khi cho phép đưa vào hàng đợi.
- Các trạng thái review gồm loading, empty, cookie hết hạn, trùng lặp, không khả dụng và lỗi quét nguồn.
- Trạng thái bền vững “Đã xếp hàng” biểu thị ingest job đã được tạo, không biểu thị checkbox đang được chọn.
- Theo dõi nguồn từ lựa chọn hàng loạt tự khử trùng theo nền tảng + tác giả/kênh và luôn yêu cầu xác nhận.
- Thêm và sửa watchlist dùng chung source-summary form; xóa watchlist luôn qua confirmation modal.
- Validation nguồn bao gồm miền không hỗ trợ, lệch nền tảng, URL private/local, nguồn đã có trong watchlist và nguồn bị gỡ/không truy cập được.
- Nền tảng là bộ lọc bắt buộc, mặc định Douyin và không có chế độ “Tất cả nền tảng”. Mỗi provider sở hữu riêng page/cursor, tổng kết quả, cookie, lỗi và rate limit; đổi provider luôn xóa selection và quay về trang đầu.
- Watchlist và hành động quét chỉ áp dụng cho provider đang chọn. Nhãn quét nêu rõ nền tảng và mọi lần quét tự động vẫn chỉ thu metadata.
- Phân trang provider dùng 20, 50 hoặc 100 dòng/trang. Tổng dạng “Douyin · 126 video · Trang 1/7” không cộng dồn dữ liệu giữa Douyin và Bilibili.
- Khi cookie hết hạn, màn hình chặn truy vấn metadata mới và không giả lập dữ liệu cũ như kết quả đang hoạt động. Người dùng có thể cập nhật cookie hoặc chọn rõ “Xem dữ liệu đã lưu”; lỗi của provider này không ảnh hưởng provider khác.

### Hợp đồng dữ liệu mô phỏng

`GET /discovery/videos?platform=douyin&cursor=...&limit=20&status=...&watchlist_id=...`

`platform` luôn bắt buộc. Prototype không tạo truy vấn “all platforms” và không dùng chung cursor giữa các provider.

## Hệ thống hình ảnh

- **Nền:** canvas warm off-white `--bg`; card, topbar, drawer và dialog dùng `--surface` trắng; sidebar dùng sage rất nhạt `--surface-warm`; các vùng vận hành phụ dùng `--panel-subtle`.
- **Typography:** Inter Variable cho toàn bộ UI, bật `"cv01", "ss03"`; weight 510 cho nhãn/UI, 590 cho tiêu đề quan trọng; Berkeley Mono cho số liệu kỹ thuật.
- **Màu:** sage green `--accent` và `--accent-strong` liên kết nhận diện, trạng thái chọn, chart, progress, link và focus; `--accent-soft` tạo nền phản hồi nhẹ. Đỏ chỉ dành cho lỗi, amber chỉ dành cho cảnh báo và xanh lá dành cho trạng thái khỏe/online.
- **Bố cục:** lưới 8px, sidebar 248px, nội dung tối đa 1600px; card radius 12px, border xanh-xám 1px và shadow rất nhẹ; khoảng cách giữa các nhóm tăng vừa đủ nhưng vẫn giữ mật độ của công cụ vận hành.
- **Motion:** 150–200ms cho hover, drawer và phản hồi; tắt chuyển động khi người dùng bật `prefers-reduced-motion`.
- **Trạng thái tương tác:** hover và active thay đổi đồng thời nền/viền nhưng giữ foreground đậm; selected dùng nền sage mềm và chữ xanh đậm; focus dùng vòng xanh hai lớp rõ trên nền trắng, warm white và sage.
- **Số liệu:** số vận hành dùng tabular numerals trong font UI; monospace chỉ còn cho mã job, tên tệp, timestamp và metadata kỹ thuật thực sự.

## Dữ liệu mẫu

Dữ liệu hiển thị được ghi rõ là **dữ liệu mẫu** và mô phỏng một ca vận hành ngày 31/08/2026: 42 video trong pipeline, 3 job đang chạy, 4 job chờ GPU, 6 video cần duyệt và 9 video sẵn sàng đăng. Chi phí GPU là ước tính theo snapshot đơn giá của worker, không phải hóa đơn hoặc giá EzyCloudX được hard-code.

## Responsive

- **≥ 1180px:** sidebar đầy đủ; dashboard dùng lưới 12 cột.
- **768–1179px:** sidebar thu gọn; KPI 2 cột; panel vận hành xếp lại; bảng khám phá chuyển thành card từ 900px để không cuộn ngang.
- **< 768px:** sidebar thành drawer; topbar ưu tiên menu, tiêu đề và thông báo; toàn bộ card về một cột; không có cuộn ngang.

## Khả năng tiếp cận

- Touch target tối thiểu 44px, focus ring rõ cho mọi control.
- Trạng thái không chỉ dựa vào màu: luôn có nhãn văn bản hoặc biểu tượng.
- Chart có số liệu và mô tả text tương ứng; progress bar có `aria-valuenow`.
- Overlay có Escape để đóng, giữ focus hợp lý và trả focus về control đã mở.
