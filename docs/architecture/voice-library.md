# Voice Library — contract và schema MVP

- **Trạng thái:** `ACCEPTED`
- **Phạm vi:** metadata Voice Profile, sample audio, license gate, REST contract và
  quan hệ với Channel/Series Profile.
- **Ngoài phạm vi:** triển khai OmniVoice/GPU Worker, cast editor, segment re-gen,
  benchmark chất lượng giọng và format nội bộ của prepared voice prompt.

## 1. Quyết định chính

1. `VoiceProfile` là identity nghiệp vụ có version; audio không nằm trực tiếp trên
   row này mà đi qua Asset Registry.
2. Một voice có nhiều reference sample theo ngôn ngữ. Mỗi ngôn ngữ có lịch sử
   revision và tối đa một link `is_current = true`.
3. MVP cần một current sample ở `primaryLanguage` dài khai báo từ 3–10 giây, có
   transcript, trước khi voice được chuyển sang `READY`.
4. `READY` chỉ có nghĩa metadata/sample/license đã qua gate của Control Plane;
   không tuyên bố Worker đã benchmark chất lượng hoặc đã tạo prompt.
5. Hệ thống phục vụ nội dung có khả năng kiếm tiền, nên voice chỉ được `READY`
   khi `commercialUseAllowed = true`. Nguồn `CC_BY_NC` và `UNKNOWN` luôn bị chặn.
6. Mọi audio upload/download dùng presigned R2 URL ngắn hạn. URL không lưu DB,
   không đưa vào TanStack Query cache, idempotency record hoặc log.
7. Job snapshot lưu voice ID/version và sample asset/link/revision đã chọn. Job cũ
   không đọc Voice Profile mutable khi retry.

## 2. Domain model

### 2.1 Voice Profile

```text
VoiceProfile
  id                    UUID v7
  name                  1..120 ký tự
  normalizedName        NFKC + lowercase, unique trong single workspace
  primaryLanguage       BCP 47
  description           nullable, tối đa 2.000 ký tự
  tags                  string[], tối đa 20 tag, mỗi tag 1..40 ký tự
  status                DRAFT | READY | BLOCKED_LICENSE | ARCHIVED
  licenseKind           OWNED_RECORDING | AUTHORIZED_COMMERCIAL |
                        CC_BY | CC_BY_NC | CUSTOM | UNKNOWN
  licenseReference      nullable text/URL, tối đa 2.000 ký tự
  commercialUseAllowed  boolean
  sourceReference       nullable text/URL, tối đa 2.000 ký tự
  version               integer
  createdAt / updatedAt timestamptz
```

`commercialUseAllowed` là attestation nghiệp vụ rõ ràng, không được suy ra từ
note tự do. Quy tắc:

- `CC_BY_NC` và `UNKNOWN` bắt buộc `false` và status hiệu lực là
  `BLOCKED_LICENSE`;
- `AUTHORIZED_COMMERCIAL`, `CC_BY`, `CUSTOM` muốn bật `true` phải có
  `licenseReference`;
- `OWNED_RECORDING` có thể bật `true` mà không cần URL, nhưng UI phải yêu cầu
  người vận hành xác nhận họ có quyền sử dụng bản ghi;
- thay đổi license của voice `READY` sang không hợp lệ được phép và chuyển voice
  sang `BLOCKED_LICENSE`. Profile phụ thuộc trở thành not-ready; Job đã snapshot
  không đổi, nhưng không được tạo Job mới.

Không lưu giới tính, tuổi hoặc cảm xúc như enum cứng. Nếu cần tìm kiếm mô tả chất
giọng, dùng tags do người vận hành quản lý; không biến nhận định chủ quan thành dữ
liệu định danh cá nhân.

### 2.2 Reference sample

```text
VoiceProfileSample
  id               UUID v7 (link ID)
  voiceProfileId   UUID FK
  assetId          UUID FK
  language         BCP 47
  transcript       1..1.000 ký tự
  durationMs       3.000..10.000 (khai báo ở upload/commit)
  revision         integer >= 1
  isCurrent        boolean
  createdAt        timestamptz

UNIQUE(voiceProfileId, language, revision)
partial UNIQUE(voiceProfileId, language) WHERE isCurrent = true
```

Asset phải `AVAILABLE`, có role nghiệp vụ `VOICE_REFERENCE_SAMPLE` trong metadata
và chứa ít nhất:

```text
fileName, contentType, byteSize, checksumSha256?, durationMs,
storageBackend, bucket, objectKey, version
```

MIME MVP: WAV, FLAC, MPEG audio hoặc WebM audio; tối đa 15 MiB. Control Plane
kiểm tra HEAD metadata khi commit. Duration thực và khả năng decode sẽ được Worker
kiểm tra khi adapter media tồn tại; trước đó API chỉ tin duration khai báo trong
giới hạn và không giả vờ đã phân tích waveform.

Thay sample tạo asset/link revision mới rồi atomically hạ `isCurrent` của revision
cũ. Asset cũ không bị xóa ngay vì Job snapshot hoặc retention có thể còn tham
chiếu. Không được detach current sample bắt buộc khi voice đang `READY`; phải
commit replacement hoặc chuyển voice về `DRAFT` trước.

### 2.3 Chọn sample cho pipeline

Khi target language có current sample cùng BCP 47, dùng sample đó. Nếu không có,
dùng sample của `primaryLanguage` cho cross-lingual clone và ghi rõ fallback trong
Job snapshot. Không tự chọn một sample bất kỳ. Snapshot tối thiểu:

```text
voiceProfileId, voiceProfileVersion,
sampleLinkId, sampleAssetId, sampleRevision, sampleLanguage,
requestedLanguage, usedCrossLingualFallback,
assetVersion, objectKey, checksumSha256
```

`ProfileJobSnapshot.schemaVersion` sẽ tăng từ 1 lên 2 khi Voice Library API được
triển khai để thêm identity trên. Prepared OmniVoice prompt là artifact dẫn xuất
theo `(sampleAssetId, sampleRevision, engineVersion)`; format/checksum sẽ được chốt
sau adapter probe và không làm thay đổi sample gốc.

## 3. Readiness và lifecycle

Readiness issues dùng code ổn định:

- `VOICE_PRIMARY_SAMPLE_REQUIRED`
- `VOICE_SAMPLE_TRANSCRIPT_REQUIRED`
- `VOICE_SAMPLE_DURATION_INVALID`
- `VOICE_LICENSE_REFERENCE_REQUIRED`
- `VOICE_COMMERCIAL_USE_NOT_ALLOWED`
- `VOICE_SAMPLE_NOT_AVAILABLE`

Transition:

```text
DRAFT --activate, gates pass--> READY
DRAFT --activate, license fails--> BLOCKED_LICENSE
READY --license revoked---------> BLOCKED_LICENSE
READY/BLOCKED_LICENSE --archive> ARCHIVED
ARCHIVED --restore-------------> DRAFT
```

- Metadata/sample được sửa ở `DRAFT` hoặc `BLOCKED_LICENSE`.
- Metadata mô tả/tags có thể sửa ở `READY`; thay sample hoặc quyền sử dụng làm
  tăng version và chạy lại readiness.
- Archive bị từ chối nếu voice còn được Channel/Series/Cast không archived tham
  chiếu. Rights revocation không bị từ chối vì hệ thống phải có khả năng dừng sử
  dụng ngay.
- Profile API phải đưa voice version vào effective ETag/readiness. Voice mutation
  phát domain event/SSE invalidation cho query `profiles` và `voices`.

## 4. PostgreSQL migration đề xuất

Mở rộng `voice_profiles` hiện có:

```text
normalized_name         text NOT NULL UNIQUE
primary_language        text NOT NULL
description             text nullable
tags                    text[] NOT NULL DEFAULT '{}'
license_kind            voice_license_kind NOT NULL DEFAULT 'UNKNOWN'
license_reference       text nullable
source_reference        text nullable
commercial_use_allowed  boolean NOT NULL DEFAULT false
status                  voice_profile_status NOT NULL DEFAULT 'DRAFT'
version                 integer NOT NULL DEFAULT 1
```

Đổi tên logical field `language` hiện tại thành `primary_language`; migration có
thể map dữ liệu development hiện có. Thêm `voice_profile_samples` như mục 2.2.
Không thêm bảng binary riêng; dùng `assets`. Không thêm `voice_prompt` vào DB cho
tới khi adapter xác nhận artifact đó cần persist thay vì cache có thể tái tạo.

Index phục vụ màn hình:

```text
voice_profiles(status, primary_language, created_at, id)
GIN voice_profiles(tags)
voice_profile_samples(voice_profile_id, language, is_current)
voice_profile_samples(asset_id)
```

## 5. REST contract đề xuất

```text
GET    /v1/voice-profiles
POST   /v1/voice-profiles
GET    /v1/voice-profiles/{voiceProfileId}
PATCH  /v1/voice-profiles/{voiceProfileId}
POST   /v1/voice-profiles/{voiceProfileId}/activate
POST   /v1/voice-profiles/{voiceProfileId}/archive
POST   /v1/voice-profiles/{voiceProfileId}/restore

POST   /v1/voice-profiles/{voiceProfileId}/samples/uploads
POST   /v1/voice-profiles/{voiceProfileId}/samples/uploads/{assetId}/grant
POST   /v1/voice-profiles/{voiceProfileId}/samples/uploads/{assetId}/commit
GET    /v1/voice-profiles/{voiceProfileId}/samples/{sampleId}/preview
DELETE /v1/voice-profiles/{voiceProfileId}/samples/{sampleId}
```

List filters: cursor, limit, query, status, language, tag và
`commercialUseAllowed`. Mặc định loại `ARCHIVED`.

Concurrency/idempotency:

- detail trả strong `ETag: "<voiceVersion>"`;
- PATCH/activate/archive/restore/detach/commit yêu cầu `If-Match`;
- POST create và commit yêu cầu `Idempotency-Key`;
- commit sample tăng Voice version vì effective resource đã đổi;
- replay cùng key + cùng request hash trả nguyên response/ETag; khác payload trả
  validation error.

Response Voice Profile gồm metadata, `samples[]`, `readiness`,
`readinessIssues[]`, `referencedBy` counts và version. Không trả bucket/object key,
credential hoặc presigned URL trong resource response.

## 6. Upload và preview flow

1. Web request purpose-scoped PUT grant với language, transcript, duration, MIME,
   byte size và optional checksum.
2. Browser PUT trực tiếp lên R2 với đúng signed headers.
3. Web commit bằng `If-Match` + `Idempotency-Key`.
4. API HEAD object, so byte size/MIME, tạo revision/link và tăng Voice version
   trong một transaction.
5. Khi nghe sample, Web gọi preview endpoint, nhận GET grant 5 phút và gán URL
   trực tiếp vào audio element state. URL không đi qua persistent/query cache.

Pending upload có thể xin lại grant cho cùng `assetId`; không tạo pending row mới.
Pending hết hạn được cleanup theo policy asset chung.

## 7. Web acceptance cho task sau

- List/table responsive với search, status, language, license và tags.
- Create/edit form dùng shadcn; license fields giải thích rõ commercial gate.
- Sample recorder không thuộc MVP. Người dùng chọn file, nhập transcript/language,
  thấy duration khai báo và nghe preview trước/sau upload.
- Detail drawer hiển thị revisions hiện hành, dependency counts và lý do not-ready.
- Không hiển thị action `READY` như toggle tùy ý; activation là mutation có
  validation và lỗi cụ thể.
- Không copy HTML từ OpenDesign; dùng design tokens và shadcn hiện có.

## 8. Test acceptance

- validation BCP 47, normalized unique name, tags, transcript, duration/MIME/size;
- license matrix và transition `DRAFT/READY/BLOCKED_LICENSE/ARCHIVED`;
- upload grant, re-grant, HEAD verification, idempotent commit, revision replacement,
  preview và detach guard;
- optimistic concurrency trên metadata và sample commit;
- voice/license/sample mutation làm Profile readiness/ETag thay đổi;
- Job snapshot giữ voice/sample identity cũ sau replacement hoặc license change;
- Web list/filter/form/player, conflict refetch, mobile và accessibility;
- signed URL/credential không xuất hiện trong DB response, query persistence hoặc log.

## 9. Deferred có chủ đích

- prepared prompt format và persistence: chờ OmniVoice adapter probe;
- server-side waveform, silence/SNR và duration verification: chờ media probe;
- recording in browser, automatic transcript và voice quality scoring;
- cast sheet CRUD và multi-speaker assignment: thuộc Profile/Studio sau khi Voice
  Library đã có voice `READY`;
- xóa vật lý audio: do retention/cleanup job, không làm trong HTTP request.
