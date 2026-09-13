# ADR: Just-in-Time Contract theo vertical slice

- Trạng thái: `ACCEPTED`
- Nguồn chuẩn cho: thời điểm thiết kế, kiểm chứng và ổn định contract giữa Web, API và Worker.
- Không phải nguồn chuẩn cho: wire convention cụ thể, endpoint inventory hoặc chi tiết implementation.
- Thay thế: —
- Được thay thế bởi: —

## Bối cảnh

Web, NestJS API và Python Worker cần một contract chung để nhiều người hoặc AI
agent triển khai song song. Tuy nhiên, nếu contract phải được thiết kế, review và
đóng băng trước implementation, discovery bị tách khỏi code và feedback
end-to-end đến quá muộn. AI làm tăng tốc độ sinh code nhưng cũng khuếch đại lượng
code phải sửa khi contract ban đầu sai.

Quyết định này thay cách triển khai Contract-First theo phase từng được mô tả
trong `architecture/application.md` §7; không thay các wire convention đã chốt.

## Quyết định

Dự án dùng **Just-in-Time Contract theo từng vertical slice**:

1. Chọn một hành vi người dùng nhỏ và viết acceptance criteria.
2. Phác thảo UI/luồng dữ liệu và draft contract tối thiểu cho riêng slice đó.
3. Generate type/client từ draft để Web, API và Worker làm song song ngay; không có gate `APPROVED` trước implementation.
4. Chạy integration/E2E sớm, sửa contract và tất cả consumer cùng slice khi phát hiện thiết kế chưa phù hợp.
5. Chỉ đánh dấu contract `VERIFIED` sau khi slice chạy end-to-end; contract trở thành `STABLE` khi đã release hoặc có consumer độc lập.

Implementation nội bộ tiếp tục Code-First. OpenAPI/event schema chỉ áp dụng tại
integration boundary và không được lập thành một phase nền móng độc lập với
feature.

## Lựa chọn đã cân nhắc

- Contract-First với gate duyệt trước implementation: hỗ trợ chia việc nhưng làm feedback chậm và tăng chi phí sửa khi contract sai.
- Code-First hoàn toàn, không có contract dùng chung: nhanh cho một luồng nhưng Web/API/Worker và các AI agent dễ drift khi làm song song.
- Thiết kế toàn bộ schema sản phẩm trước: tạo cảm giác đầy đủ nhưng khóa sớm các phần nghiệp vụ chưa được kiểm chứng.

## Hệ quả

- Một vertical slice, contract, implementation và test nằm cùng một đơn vị giao việc/pull request.
- Web/API/Worker có thể bắt đầu song song từ draft nhỏ và chủ động đề xuất thay đổi trong quá trình làm.
- Phải có integration owner cho mỗi slice để reconcile contract và chạy E2E.
- Breaking change trước `STABLE` không cần version mới nếu mọi consumer được cập nhật cùng nhau.
- Contract `STABLE` vẫn áp dụng compatibility và versioning nghiêm ngặt.
- Không tạo epic/task chỉ để hoàn thành toàn bộ contract trước feature đầu tiên.

## Cách kiểm chứng

- Mỗi pull request nghiệp vụ chỉ thêm contract cho endpoint/event mà slice sử dụng.
- Pull request có acceptance criteria và ít nhất một integration/E2E test cho đường chạy của slice.
- Generated artifact khớp contract hiện tại và không được sửa tay.
- Không có contract `STABLE` bị breaking change nếu không tăng version hoặc có kế hoạch tương thích ngược.
