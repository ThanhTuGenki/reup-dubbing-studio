# Known follow-ups — Giai đoạn 1 (MVP)

> ⚠️ **File này là tracker TẠM.** Nguồn chuẩn cho trạng thái công việc là
> [GitHub Project #1](https://github.com/users/ThanhTuGenki/projects/1), không phải
> Markdown. Mỗi mục dưới đây cần được chuyển thành một Issue có `Risk` và
> `Acceptance criteria`; chuyển xong thì xoá khỏi đây và để lại số Issue.
> Giữ hai nơi song song sẽ drift.


Những mục dưới đây được **phát hiện, xác minh và cố ý để lại** trong quá trình review.
Không mục nào làm sai output đã render. Ghi lại ở đây để Giai đoạn 2 không phải tìm lại.

## 1. Resume dịch trả tiền lại cho phần đã dịch xong (Important)

`stage_translate` ghi `script.json` sau **mỗi** batch 50 câu, nên một lần lỗi giữa chừng
không mất phần đã trả tiền. Nhưng khi chạy lại, nó nạp lại từ `segments_{ocr|asr}.json`
(bản gốc, `text_vi` rỗng) chứ **không** nạp `script.json` đang dở, nên nó gửi lại **toàn
bộ** batch lên API tính phí — kể cả những batch đã thành công và đã được lưu.

Hệ quả: bản lưu từng batch tồn tại nhưng không bao giờ được đọc lại, nên lợi ích chính
của nó chưa thành hiện thực. Không sai output, chỉ tốn tiền.

Cách sửa: khi `script.json` tồn tại nhưng chưa đầy đủ, nạp nó làm điểm bắt đầu và chỉ
dịch những câu còn `text_vi` rỗng.

## 2. Câu dịch ra rỗng hợp lệ khiến video đó dịch lại mãi mãi (Important)

Cổng kiểm tra hoàn chỉnh là "mọi câu có `text_src` đều phải có `text_vi` không rỗng".
Nhưng `parse_response` trả `""` cho cả hai trường hợp: mô hình **bỏ sót** một index, và
mô hình **cố ý** dịch ra chuỗi rỗng. Không có cách phân biệt.

Hệ quả: nếu một câu bị mô hình trả rỗng một cách hợp lệ, video đó không bao giờ đạt trạng
thái "đã dịch xong", nên **mỗi lần** `reup run` sau này đều dịch lại toàn bộ (kết hợp với
mục 1 ở trên) cho tới khi sửa tay `script.json`.

Cách sửa: đánh dấu trạng thái hoàn thành riêng (một khóa trong `timings.json` hoặc file
`.done`), thay vì suy ra từ nội dung.

## 3. Lỗi LLM trả về hỏng vẫn hiện traceback thô (Minor)

`run()` bắt `RuntimeError` để in thông báo gọn kèm đường dẫn log, nhưng
`translate.parse_response` raise `ValueError` khi phản hồi không chứa JSON hợp lệ — nên
trường hợp đó vẫn đổ traceback ra màn hình thay vì thông báo sạch.

Cách sửa: bắt thêm `ValueError` ở cùng chỗ.

## 4. Môi trường: cờ `UF_HIDDEN` trên macOS

Máy đang chạy một tiện ích ẩn Desktop (`iCloud.com.zerone.hidesktop`) liên tục gắn cờ
`UF_HIDDEN` lên file dưới `~/Desktop`. Việc này phá Python site machinery với các file
`.pth` của venv, khiến `import reup` chết theo chu kỳ.

Tạm thời: `chflags nohidden .venv/lib/python3.11/site-packages/*.pth`.
Trị gốc (thuộc quyền chủ máy): loại trừ thư mục project khỏi tiện ích đó, hoặc chuyển
project ra khỏi `~/Desktop`.

## 5. Các minor còn hoãn

- `desub.desub()` đặt tên tham số `input`/`output` trùng builtin (theo đúng plan).
- `to_srt` xuất cue rỗng cho câu chưa dịch (vô hại với hầu hết trình phát).
- `tts.py` thay `{text}` trước `{out}`, nên một câu chứa đúng chuỗi `{out}` sẽ bị viết lại.
- Thông báo lỗi bằng tiếng Việt trong khi commit message bằng tiếng Anh.
- `urlparse` chấp nhận khoảng trắng đầu URL (đã xác minh không khai thác được: scheme sai
  vẫn bị chặn và `--` luôn được chèn).
- `audio.mix` bỏ qua demucs chỉ dựa trên `no_vocals.wav` tồn tại, không kiểm tính toàn vẹn.
