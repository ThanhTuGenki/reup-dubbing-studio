# Douyin Discovery — thiết kế dữ liệu và kế hoạch triển khai

- **Trạng thái:** `DRAFT` — đủ chi tiết để chia vertical slice và triển khai; các
  endpoint nội bộ vẫn phải qua integration smoke test trước mỗi release.
- **Cập nhật:** 2026-09-17.
- **Nguồn chuẩn cho:** cách thu thập, chuẩn hóa, lưu và hiển thị dữ liệu Douyin
  trong màn hình Discovery; ranh giới Discovery → Ingest; mô hình dữ liệu nguồn;
  yêu cầu bảo mật cookie và vận hành browser session.
- **Không phải nguồn chuẩn cho:** contract OpenAPI đã `VERIFIED`, schema Prisma đã
  migrate, thiết kế pipeline media sau khi ingest, hoặc điều khoản sử dụng của
  Douyin.
- **Tài liệu liên quan:**
  [`product/design.md`](../product/design.md),
  [`application.md`](application.md),
  [`database-design.md`](database-design.md),
  [`prototype Discovery đã archive`](../reference/ui-prototype/discovery.html),
  [`api-hexagonal-slices`](decisions/2026-09-14-api-hexagonal-slices.md),
  [`just-in-time-contracts`](decisions/2026-09-13-just-in-time-contracts.md).

## 1. Mục tiêu

Sau khi triển khai tài liệu này, người dùng có thể:

1. Chọn một tài khoản nguồn Douyin còn hiệu lực.
2. Duyệt feed Jingxuan “Tất cả” hoặc theo category.
3. Dán link tác giả để liệt kê video của tác giả.
4. Dán link video hoặc collection/mix để resolve nội dung.
5. Tìm video theo từ khóa khi phiên Douyin không bị challenge.
6. Lưu tác giả/collection làm watchlist và phát hiện nội dung mới.
7. Lọc, chọn nhiều item và enqueue ingest mà không tạo video/job trùng.
8. Nhìn thấy rõ lỗi cookie, captcha, rate limit, loại nội dung chưa hỗ trợ và
   trạng thái ingest.

Discovery chỉ lấy metadata và remote media candidate. Nó không tải file video
lớn vào R2. Việc tải bắt đầu khi người dùng chọn item và tạo `video`/ingest job.

## 2. Kết luận kiến trúc

### 2.1 Không gọi endpoint nội bộ bằng HTTP tĩnh

Các endpoint web của Douyin yêu cầu tập tham số fingerprint thay đổi theo phiên,
đặc biệt `a_bogus`, `webid`, `verifyFp`, `fp`, `uifid`, thông tin browser và các
cookie vừa được cập nhật. Thử gọi HTTP trực tiếp cho kết quả không ổn định: endpoint
v1 có thể trả HTTP 200 với body rỗng, còn đường v2 thô có thể trả 404.

Adapter MVP phải dùng Chromium/Playwright:

1. Tạo browser context cô lập cho một `source_account`.
2. Nạp cookie Douyin đã giải mã vào context.
3. Điều hướng tới trang Douyin tương ứng.
4. Lắng nghe response từ các endpoint đã allowlist.
5. Parse JSON response, normalize và upsert trong một transaction ngắn.
6. Lưu lại cookie đã được Douyin refresh dưới dạng ciphertext mới.
7. Đóng context sau khi run kết thúc.

Không tự sinh hoặc reverse-engineer `a_bogus` trong code ứng dụng. Trình duyệt của
Douyin tự tạo chữ ký; adapter chỉ đọc response của navigation hợp lệ.

### 2.2 Không dùng yt-dlp để list trang tác giả Douyin

Kiểm chứng với `yt-dlp 2025.12.08`:

- URL `/user/{sec_uid}` trả `Unsupported URL`.
- URL video đơn được nhận diện bởi extractor Douyin nhưng cookie hiện tại bị báo
  cần cookie mới.

Vì vậy:

- Listing Douyin thuộc `DouyinBrowserDiscoveryProvider`.
- `yt-dlp --flat-playlist` chỉ tiếp tục dùng cho platform/extractor thật sự hỗ trợ,
  ví dụ Bilibili hoặc YouTube.
- Ingest video Douyin có thể tiếp tục ưu tiên yt-dlp, nhưng phải nhận cookie mới
  được export từ browser context ngay trước khi chạy và phải có preflight riêng.
- Nếu yt-dlp vẫn thất bại, job trả lỗi có mã; không âm thầm tải một format chất
  lượng thấp từ `play_addr`.

### 2.3 DB độc lập với shape của Douyin

Endpoint, field và cơ chế pagination của Douyin là implementation detail của
provider. Domain chỉ nhận model chuẩn hóa. Payload gốc được giữ ngắn hạn để debug
và reparse, không biến toàn bộ JSON Douyin thành schema quan hệ.

## 3. Bằng chứng đã kiểm chứng

Điều tra dùng Chrome headless với cookie Netscape do chủ dự án cung cấp. Không ghi
cookie, token ký, ID tài khoản hoặc nội dung riêng tư vào repository/log.

### 3.1 Jingxuan

Trang `https://www.douyin.com/jingxuan` trả HTTP 200 và phát sinh request:

```text
GET /aweme/v2/web/module/feed/
```

Các tham số nghiệp vụ quan sát được:

| Tham số | Ý nghĩa sử dụng |
| --- | --- |
| `module_id=3003101` | Feed Jingxuan |
| `refer_type=10` | Ngữ cảnh Jingxuan |
| `count` | Lần đầu thường 8; batch tiếp theo thường 20 |
| `tag_id` | ID category; rỗng là “Tất cả” |
| `refresh_index` | Số lần refresh/load tiếp |
| `use_lite_type` | Shape/lite mode của response |
| `filterGids` | ID đã thấy để tránh lặp |
| `presented_ids` | ID đã được trình bày |
| `pre_item_ids` | Item trước đó |
| `pre_room_ids` | Live room trước đó |
| `pull_type` | Kiểu pull/refresh |

Ngoài ra request có fingerprint/browser params và `a_bogus`; chúng là opaque,
không lưu vào domain model và không log giá trị.

Response đã quan sát:

```text
status_code, status_msg
aweme_list
has_more
max_cursor, min_cursor
log_pb, rid, extra
cache_info, client_cache_strategy
remain_item_ids, filter_infos
```

Một phiên trả batch 8 item, sau đó batch 20 item. Feed thực tế chứa cả video
`aweme_type=0` và live card `aweme_type=101`. UI Douyin tự dedupe theo `aweme_id`.

### 3.2 Category

Route category có dạng:

```text
/jingxuan/course
/jingxuan/game
/jingxuan/acg
/jingxuan/music
/jingxuan/food
/jingxuan/knowledge
/jingxuan/sports
/jingxuan/theater
/jingxuan/film
/jingxuan/vlog
/jingxuan/child
/jingxuan/car
/jingxuan/agriculture
/jingxuan/animal
/jingxuan/travel
/jingxuan/beauty
```

Mapping hiện tại:

| Label | Slug | External key |
| --- | --- | --- |
| Tất cả | `all` | `0` |
| Khóa học công khai | `course` | `100000` |
| Game | `game` | `300205` |
| ACG | `acg` | `300206` |
| Âm nhạc | `music` | `300209` |
| Ẩm thực | `food` | `300204` |
| Kiến thức | `knowledge` | `300213` |
| Thể thao | `sports` | `300207` |
| Tiểu phẩm | `theater` | `300214` |
| Phim ảnh | `film` | `300215` |
| Vlog | `vlog` | `300216` |
| Cha mẹ/trẻ em | `child` | `300217` |
| Ô tô | `car` | `300218` |
| Nông nghiệp | `agriculture` | `300219` |
| Động vật | `animal` | `300220` |
| Du lịch | `travel` | `300221` |
| Làm đẹp/thời trang | `beauty` | `300222` |

Danh sách category đến từ config của Douyin. Bảng trên chỉ là fallback seed;
adapter phải upsert category động và không dùng PostgreSQL enum cho category.

Category thông thường vẫn dùng module feed với `tag_id`. Route knowledge đã được
quan sát với `tag_id=300213`, `count=20`, `refresh_index=1`.

### 3.3 Course là feed riêng

Course không chỉ là module feed. Trang gọi:

```text
GET /aweme/v1/web/douyin/select/tab/course/catagory/tag/
GET /aweme/v1/web/douyin/select/tab/course/catagory/video/
```

Tag request dùng `tab_id=screen_course_page`. Video request dùng:

```text
tab_id=screen_course_page
offset=0,6,12,...
size=6
tag_id_list=[...]
id_list=...
```

Response video có `video_items`, `has_more`, `offset`, `status_code`. Pagination
course vì vậy dùng offset trả bởi server, không dùng `max_cursor`.

### 3.4 Trang tác giả

Trang `/user/{sec_uid}` đã được kiểm chứng có danh sách video và gọi:

```text
GET /aweme/v1/web/user/profile/other/
GET /aweme/v1/web/aweme/post/
```

`aweme/post` dùng `sec_user_id`, `count=18`, `max_cursor`. Response có:

```text
aweme_list
has_more
max_cursor, min_cursor
post_serial
replace_series_cover
request_item_cursor
time_list
```

`sec_uid` phải được coi là opaque string. Không ép `uid`, `aweme_id`, `mix_id` hay
room ID vào JavaScript/PostgreSQL integer vì có thể vượt giới hạn an toàn.

### 3.5 Search

Bundle hiện tại định nghĩa các endpoint:

| Mode | Endpoint |
| --- | --- |
| General | `/aweme/v1/web/general/search/single/` |
| General streaming | `/aweme/v1/web/general/search/stream/` |
| Video | `/aweme/v1/web/search/item/` |
| User | `/aweme/v1/web/discover/search/` |
| Live | `/aweme/v1/web/live/search/` |
| Visual | `/aweme/v1/web/search/general/vision/` |

Navigation trực tiếp tới search trong phiên thử nghiệm bị chuyển tới trang xác
minh captcha. Search phải được triển khai sau Jingxuan và creator, đặt sau feature
flag, có cooldown và UX yêu cầu người dùng làm mới credential/session. Không retry
captcha tự động liên tục.

### 3.6 Collection/mix

Client hiện tại tham chiếu:

```text
GET /aweme/v1/web/mix/aweme/
```

Contract quan sát từ code dùng `mix_id`, `cursor`, `count` và trả `aweme_list`,
`has_more`, cursor. Phiên feed thử nghiệm không có sample mix có ID để kiểm chứng
end-to-end. Mode này chỉ được bật sau integration fixture thật và smoke test.

### 3.7 Loại item

Các discriminator được client Douyin hỗ trợ:

| Raw type | Ý nghĩa | MVP ingest |
| --- | --- | --- |
| `0` | Video thường | Có |
| `4` | New normal | Có sau normalization test |
| `59` | Playback | Chưa |
| `68` | Note | Metadata; chưa ingest |
| `101` | Live card | Không |
| `105` | Variety/replay | Chưa |
| `107` | XG video | Chưa |
| `128` | Long video | Có sau format test |
| `151` | Slides | Metadata; chưa ingest |
| `163` | Article | Metadata; chưa ingest |

Frontend Douyin còn chèn card không phải aweme:

```text
item_type=card_ad
item_type=sub_tab_live
```

Hai loại này không tạo `source_content`; raw event chỉ ghi số lượng đã bỏ qua.

## 4. Capability matrix

| Mode | Input | Provider | Pagination | Trạng thái |
| --- | --- | --- | --- | --- |
| Jingxuan all | Không | Browser/module feed | Opaque + refresh index | Đã kiểm chứng |
| Jingxuan category | Category | Browser/module feed | Opaque + refresh index | Đã kiểm chứng |
| Course | Category/tag | Browser/course endpoints | Offset | Đã kiểm chứng |
| Creator | User URL | Browser/profile + post | `max_cursor` | Đã kiểm chứng |
| Video URL | Video/short URL | Browser/detail | Không | Cần fixture |
| Collection/mix | Collection URL | Browser/mix | Cursor | Cần fixture |
| Keyword video | Text | Browser/search item | Cursor | Experimental/captcha |
| Keyword user | Text | Browser/discover search | Cursor | Experimental/captcha |
| Watchlist | Creator/mix ref | Scheduler gọi mode gốc | Theo mode | Thiết kế sẵn |

## 5. Boundary code

Module sở hữu use case là `apps/api/src/modules/discovery`. Chỉ tạo layer khi có
file thật, theo ADR hexagonal hiện hành.

Domain-facing port đề xuất:

```ts
export interface SourceDiscoveryProvider {
  readonly platform: SourcePlatform;

  validateCredential(accountId: string): Promise<CredentialHealth>;
  listCategories(accountId: string): Promise<SourceCategoryInput[]>;
  resolveInput(accountId: string, input: string): Promise<ResolvedSourceInput>;
  discover(request: ProviderDiscoveryRequest): Promise<ProviderDiscoveryPage>;
  getContent(accountId: string, externalId: string): Promise<ProviderContent>;
}
```

`ProviderDiscoveryPage` phải chứa:

```ts
type ProviderDiscoveryPage = {
  items: ProviderContent[];
  nextCursor: Record<string, unknown> | null;
  hasMore: boolean;
  responseLogId?: string;
  skipped: Record<string, number>;
  rawPayload: unknown;
};
```

Không cho domain/application layer biết URL endpoint, `a_bogus`, Playwright
`Page`, DOM selector hoặc raw cookie.

### 5.1 Browser adapter

`DouyinBrowserDiscoveryProvider` cần:

- allowlist hostname `douyin.com` và subdomain cần thiết;
- allowlist endpoint theo mode;
- response listener được đăng ký trước navigation;
- timeout riêng cho navigation và API response;
- abort image/font/media nếu mode chỉ lấy metadata, nhưng không abort request API;
- context riêng cho mỗi account/run;
- concurrency tối đa 1 run/account;
- user-agent, locale, timezone và viewport ổn định trong một credential session;
- phát hiện verification page/captcha bằng title, URL và response status code;
- cập nhật cookie ciphertext sau run thành công;
- không log full request URL vì query chứa chữ ký/token.

Browser run phải chạy qua task `IO`; controller không chờ Chrome trong HTTP
request. Với MVP có thể dùng Chromium trong image của API/runner. Nếu tải tăng,
tách process runner nhưng giữ cùng port/application contract; chưa cần tạo service
public mới.

### 5.2 Chuẩn hóa

Mapper là hàm thuần và có fixture đã sanitize:

```text
Raw Douyin JSON
  -> discriminate card/item
  -> normalize creator
  -> normalize content
  -> normalize media candidates
  -> normalize metrics snapshot
  -> normalize category/collection relations
  -> upsert transaction
```

Unknown field được giữ trong raw payload, không làm mapper thất bại. Item thiếu
`aweme_id` hoặc không thuộc allowlist type bị skip với reason counter.

## 6. Mô hình dữ liệu PostgreSQL/Prisma

Phần này là thiết kế chi tiết cho provider/Discovery. Quan hệ cross-domain, asset,
workflow và thứ tự migration do [`database-design.md`](database-design.md) sở hữu.
Khi có khác biệt, giữ mapping/provider field ở đây và dùng constraint/aggregate
boundary của tài liệu database chung.

### 6.1 Enum ổn định

Chỉ dùng enum cho khái niệm do ứng dụng sở hữu:

```text
SourcePlatform       DOUYIN | BILIBILI | YOUTUBE
CredentialStatus     ACTIVE | EXPIRED | CAPTCHA_REQUIRED | INVALID | REVOKED
DiscoveryMode        JINGXUAN | CATEGORY | COURSE | CREATOR | MIX |
                     SEARCH_VIDEO | SEARCH_USER | VIDEO_URL | WATCHLIST
DiscoveryRunStatus   QUEUED | RUNNING | SUCCEEDED | PARTIAL | FAILED | CANCELLED
SourceContentType    VIDEO | LONG_VIDEO | NOTE | SLIDES | ARTICLE | LIVE | UNKNOWN
Availability         AVAILABLE | PRIVATE | REMOVED | REGION_BLOCKED | UNKNOWN
MediaCandidateRole   COVER | COVER_169 | ORIGIN_COVER | PLAYBACK | PLAYBACK_H265 |
                     AUDIO | OTHER
WatchlistStatus      ACTIVE | PAUSED | CREDENTIAL_REQUIRED | FAILED
```

Category/tag/type code của Douyin không là database enum.

### 6.2 `source_accounts`

Một cấu hình truy cập platform, không nhất thiết trùng với creator được khám phá.

```text
id                    uuid v7 PK
platform              SourcePlatform
display_name          text
status                CredentialStatus
last_validated_at     timestamptz nullable
last_success_at       timestamptz nullable
consecutive_failures  integer default 0
cooldown_until        timestamptz nullable
version               integer default 1
created_at            timestamptz
updated_at            timestamptz
```

### 6.3 `source_credentials`

```text
id                    uuid v7 PK
source_account_id     uuid FK
kind                  text             -- NETSCAPE_COOKIE
ciphertext            bytea
encryption_key_id     text
encrypted_at          timestamptz
expires_at            timestamptz nullable
last_used_at          timestamptz nullable
revoked_at            timestamptz nullable
created_at            timestamptz
```

Chỉ một credential chưa revoked được active cho mỗi account/kind. Ciphertext dùng
AEAD ở application layer; master key nằm ngoài DB. Không lưu file cookie plaintext,
không đưa ciphertext vào API response.

### 6.4 `source_creators`

```text
id                    uuid v7 PK
platform              SourcePlatform
external_id           text             -- uid nếu có
external_secure_id    text nullable    -- sec_uid
nickname              text nullable
avatar_url             text nullable
profile_url            text nullable
availability           Availability
first_seen_at          timestamptz
last_seen_at           timestamptz
metadata               jsonb default '{}'
created_at             timestamptz
updated_at             timestamptz
```

Constraints/indexes:

```text
UNIQUE (platform, external_id)
UNIQUE (platform, external_secure_id) WHERE external_secure_id IS NOT NULL
INDEX  (platform, last_seen_at DESC)
```

### 6.5 `source_categories`

```text
id                    uuid v7 PK
platform              SourcePlatform
external_key          text
slug                  text nullable
label                 text
kind                  text             -- JINGXUAN_CATEGORY | COURSE_TAG | HASHTAG
parent_id             uuid nullable FK self
is_active             boolean default true
last_seen_at          timestamptz
metadata              jsonb default '{}'
```

`UNIQUE(platform, kind, external_key)`.

### 6.6 `source_contents`

```text
id                    uuid v7 PK
platform              SourcePlatform
external_id           text
encoded_external_id   text nullable
creator_id             uuid nullable FK
content_type           SourceContentType
external_type_code     text nullable
title                  text nullable
description            text nullable
canonical_url          text nullable
published_at           timestamptz nullable
duration_ms            integer nullable
width                  integer nullable
height                 integer nullable
availability           Availability
is_ingest_eligible     boolean
first_seen_at          timestamptz
last_seen_at           timestamptz
metadata_version       integer default 1
created_at             timestamptz
updated_at             timestamptz
```

Constraints/indexes:

```text
UNIQUE (platform, external_id)
INDEX  (platform, published_at DESC, id)
INDEX  (creator_id, published_at DESC, id)
INDEX  (availability, last_seen_at DESC)
INDEX  (content_type, published_at DESC)
```

Không đặt metrics, discovery rank hoặc signed playback URL trực tiếp vào bảng này.

### 6.7 `source_media_candidates`

Remote URL quan sát được, chưa phải asset do hệ thống sở hữu:

```text
id                    uuid v7 PK
source_content_id     uuid FK
role                  MediaCandidateRole
remote_url            text
url_fingerprint       text
codec                 text nullable
container             text nullable
bitrate               integer nullable
width                  integer nullable
height                 integer nullable
observed_at            timestamptz
expires_at             timestamptz nullable
metadata              jsonb default '{}'
```

`url_fingerprint` phải bỏ các query param chữ ký có tuổi thọ ngắn trước khi hash.
Không coi `remote_url` là định danh bền vững. `video_assets` chỉ chứa object đã tải
vào R2 với checksum/object key theo kiến trúc chung.

### 6.8 `content_metric_snapshots`

```text
id                    uuid v7 PK
source_content_id     uuid FK
captured_at            timestamptz
play_count             bigint nullable
digg_count             bigint nullable
comment_count          bigint nullable
collect_count          bigint nullable
share_count            bigint nullable
forward_count          bigint nullable
live_watch_count       bigint nullable
```

`UNIQUE(source_content_id, captured_at)`. Không biến `null` thành `0`.

### 6.9 Category và collection relations

```text
source_content_categories
  source_content_id   uuid FK
  source_category_id  uuid FK
  relation_type       text
  PK (source_content_id, source_category_id, relation_type)

source_collections
  id                  uuid v7 PK
  platform            SourcePlatform
  external_id         text
  creator_id           uuid nullable FK
  collection_type     text       -- MIX | SERIES | COURSE | PLAYLIST
  title               text nullable
  canonical_url       text nullable
  metadata            jsonb
  first_seen_at       timestamptz
  last_seen_at        timestamptz
  UNIQUE(platform, collection_type, external_id)

source_collection_items
  source_collection_id uuid FK
  source_content_id    uuid FK
  ordinal              integer nullable
  episode_label        text nullable
  PK (source_collection_id, source_content_id)
```

### 6.10 `discovery_runs`

Một lần chạy provider, kể cả watchlist:

```text
id                    uuid v7 PK
source_account_id     uuid FK
mode                  DiscoveryMode
status                DiscoveryRunStatus
input                  text nullable
query                  text nullable
category_id            uuid nullable FK
watchlist_id           uuid nullable FK
provider_cursor        jsonb nullable
requested_limit        integer nullable
page_count             integer default 0
item_count             integer default 0
skipped_counts         jsonb default '{}'
response_log_id        text nullable
error_code             text nullable
error_detail_safe      text nullable
started_at             timestamptz nullable
finished_at            timestamptz nullable
created_at             timestamptz
```

`provider_cursor` là opaque đối với application/UI. Nó có thể chứa `max_cursor`,
`refresh_index`, `offset`, exclusion IDs hoặc search cursor tùy mode.

### 6.11 `discovery_items`

```text
id                    uuid v7 PK
discovery_run_id      uuid FK
source_content_id     uuid FK
rank                  integer
page_index            integer
category_id            uuid nullable FK
is_top_card            boolean default false
is_big_card            boolean default false
provider_reason        text nullable
discovered_at          timestamptz
```

Constraints:

```text
UNIQUE (discovery_run_id, source_content_id)
UNIQUE (discovery_run_id, rank)
INDEX  (discovery_run_id, rank, id)
```

Rank thuộc lần discovery, không thuộc `source_contents`.

### 6.12 `watchlists`

```text
id                    uuid v7 PK
source_account_id     uuid FK
mode                  DiscoveryMode       -- CREATOR hoặc MIX trước
resolved_input         jsonb
display_name          text
status                WatchlistStatus
schedule_interval_min integer
next_run_at            timestamptz
last_run_at            timestamptz nullable
last_success_at        timestamptz nullable
cursor                 jsonb nullable
consecutive_failures  integer default 0
created_at             timestamptz
updated_at             timestamptz
```

Watchlist run vẫn tạo `discovery_runs`; không update nội dung trực tiếp ngoài audit
trail đó.

### 6.13 `source_raw_events`

```text
id                    uuid v7 PK
discovery_run_id      uuid FK
endpoint_kind         text
schema_version        integer
payload_checksum      text
payload               jsonb
captured_at            timestamptz
expires_at             timestamptz
```

Retention mặc định 14 ngày, có thể giảm còn 7 ngày nếu payload lớn. Không lưu
request headers, cookie, full signed URL hoặc query token. Quyền đọc bảng này chỉ
dành cho operator/admin.

### 6.14 Quan hệ với `videos`

Khi người dùng chọn item:

```text
source_contents -> videos -> pipeline_jobs
```

`videos.source_content_id` là FK bắt buộc cho ingest từ Discovery. Một content có
thể được dùng cho nhiều channel profile, nhưng trong cùng channel chỉ có một Video
aggregate: `UNIQUE(source_content_id, channel_profile_id)`. Reprocess tạo job mới
trên cùng video. Dùng partial unique index cho job ingest đang active, ví dụ:

```sql
CREATE UNIQUE INDEX one_active_ingest_per_video
ON pipeline_jobs (video_id)
WHERE kind = 'INGEST'
  AND status IN ('QUEUED', 'RUNNING', 'WAITING_FOR_GPU');
```

SQL cuối cùng phải khớp enum/model thực tế của slice Workflow khi được triển khai.

## 7. Mapping Douyin → domain

| Douyin raw | Domain |
| --- | --- |
| `aweme_id` | `source_contents.external_id` |
| `aweme_type` | `external_type_code` + mapper `content_type` |
| `desc` | `description` |
| `create_time` | `published_at` |
| `author.uid` | `source_creators.external_id` |
| `author.sec_uid` | `external_secure_id` |
| `author.nickname` | `nickname` |
| `video.duration` | `duration_ms` sau khi xác nhận đơn vị |
| `video.width`, `video.height` | dimensions |
| cover URL lists | media candidate role `COVER*` |
| playback URL lists | media candidate role `PLAYBACK*` |
| `statistics.*` / normalized `stats.*` | metric snapshot |
| `text_extra` / `cha_list` | hashtag/category relation |
| `mix_info` / `series_info` | collection + relation |
| request `tag_id` | discovery item category |
| `log_pb.impr_id` | `response_log_id`, không phải business ID |

Mapper phải hỗ trợ cả raw snake_case từ network và fixture normalized camelCase
nếu fixture đến từ SSR/client mapper. Domain output chỉ dùng một naming convention.

## 8. Idempotency và transaction

Mỗi page được xử lý như sau:

1. Validate response `status_code` và discriminator.
2. Tính checksum của payload đã bỏ token/URL query nhạy cảm.
3. Insert raw event nếu checksum chưa tồn tại trong cùng run.
4. Upsert creator theo platform + external ID.
5. Upsert content theo platform + external ID; tăng `metadata_version` khi field
   chuẩn hóa thay đổi.
6. Replace/update media candidate theo fingerprint và `observed_at`.
7. Insert metrics snapshot nếu snapshot khác lần gần nhất hoặc qua sampling window.
8. Upsert category/collection relations.
9. Insert discovery item; conflict trong cùng run thì giữ rank đầu tiên.
10. Update run cursor/count trong cùng transaction.

Không giữ DB transaction trong thời gian browser/network đang chạy.

## 9. API đề xuất theo vertical slice

Contract chỉ được chốt trong `contracts/openapi/web.openapi.yaml` khi triển khai
slice tương ứng.

### 9.1 Source account và credential

```text
POST   /v1/source-accounts
GET    /v1/source-accounts
POST   /v1/source-accounts/{id}/credentials
POST   /v1/source-accounts/{id}/validate
DELETE /v1/source-accounts/{id}/credentials/current
```

Credential import nhận multipart file Netscape, giới hạn kích thước, chỉ giữ cookie
cho domain Douyin và không echo nội dung lại.

### 9.2 Discovery

```text
GET    /v1/discovery/categories?platform=DOUYIN
POST   /v1/discovery/runs
GET    /v1/discovery/runs/{id}
POST   /v1/discovery/runs/{id}/cancel
GET    /v1/discovery/items?runId=...&cursor=...&limit=...
POST   /v1/discovery/items/ingest
```

Ví dụ create run:

```json
{
  "sourceAccountId": "uuid",
  "mode": "CATEGORY",
  "categoryId": "uuid",
  "limit": 100
}
```

HTTP create trả nhanh với run `QUEUED`. UI theo dõi qua REST polling ban đầu; khi
Notifications/SSE slice có sẵn, event chỉ báo invalidation và UI refetch REST.

Bulk ingest nhận `sourceContentIds` và `Idempotency-Key`. Response trả item nào đã
queue, item nào đã có active ingest và item nào không đủ điều kiện.

### 9.3 Watchlist

```text
POST   /v1/watchlists
GET    /v1/watchlists
PATCH  /v1/watchlists/{id}
POST   /v1/watchlists/{id}/run
DELETE /v1/watchlists/{id}
```

## 10. Màn hình Discovery

### 10.1 Bố cục

Header:

- account selector + badge `Active/Expired/Captcha required`;
- nút nhập cookie;
- thời điểm validation/sync gần nhất;
- nút refresh/run.

Modes:

1. `Jingxuan`: category tabs động.
2. `Link`: dán creator, video hoặc collection URL.
3. `Search`: video/user, có nhãn Experimental.
4. `Watchlist`: nguồn đã lưu và lịch chạy.

Kết quả luôn đọc từ DB, không bind trực tiếp component vào response Douyin.

### 10.2 Cột bảng

| Cột | Nguồn |
| --- | --- |
| Checkbox | selection state |
| Thumbnail | latest valid cover candidate |
| Nội dung | title/description rút gọn |
| Tác giả | creator nickname |
| Loại | normalized content type |
| Thời lượng | duration |
| Ngày đăng | published time |
| Lượt xem | latest metrics snapshot |
| Lượt thích | latest metrics snapshot |
| Series/course | collection relation |
| Phát hiện | first/last seen |
| Trạng thái | computed ingest/availability state |
| Hành động | mở nguồn, ingest, retry |

Không tải video preview từ signed playback URL trong table. Chỉ hiển thị cover;
nút mở nguồn dùng canonical Douyin URL trong tab mới.

### 10.3 Filter và sort

- category;
- creator;
- content type;
- duration range;
- published date range;
- mới phát hiện / đã từng thấy;
- chưa ingest / đang ingest / đã ingest / lỗi;
- ingest eligible;
- sort theo ngày đăng, lần phát hiện, view/like snapshot.

Query table dùng keyset cursor của API nội bộ. Không truyền provider cursor ra UI.

### 10.4 Trạng thái hiển thị

```text
NEW             content mới, chưa chọn
KNOWN           đã thấy ở run trước
QUEUED          đã enqueue ingest
INGESTING       đang tải/đẩy R2
INGESTED        có raw asset hợp lệ
FAILED          ingest thất bại, có retry
UNSUPPORTED     loại content chưa hỗ trợ ingest
UNAVAILABLE     private/removed/region blocked
```

Trạng thái là projection từ `source_contents`, active job và `videos/video_assets`;
không lưu một cột status trùng lặp chỉ để render table.

### 10.5 Empty/error states

UI phải phân biệt:

- không có kết quả;
- cookie hết hạn;
- cần captcha/manual refresh;
- bị rate limit/cooldown;
- link không thuộc allowlist;
- creator/private content không truy cập được;
- Douyin đổi response schema;
- run thành công một phần;
- content type không ingest được.

Không hiển thị raw response hoặc error có cookie/token. `requestId` và
`discoveryRunId` là mã hỗ trợ an toàn.

### 10.6 Tương thích với prototype đã duyệt

Route vẫn là `/discovery`. Khi triển khai, dùng prototype đã archive để tham khảo
bố cục và interaction sau:

- source analyzer;
- cookie health;
- filter metadata;
- bảng kết quả và responsive card view;
- sticky bulk action bar;
- confirmation modal trước khi tạo ingest job;
- detail drawer;
- watchlist list/editor;
- loading, empty, duplicate, unavailable và provider-error state.

Các quy tắc từ prototype vẫn áp dụng:

- platform/provider là bắt buộc, không có truy vấn gộp “tất cả platform”;
- mỗi provider có cursor, cookie health, error và rate limit riêng;
- đổi provider phải xóa selection tạm và quay về trang đầu;
- checkbox chỉ là selection tạm, chưa phải trạng thái “đã xếp hàng”;
- ingest chỉ bắt đầu sau modal xác nhận;
- page size nội bộ hỗ trợ 20, 50 hoặc 100 hàng;
- duplicate được xác định bằng platform + external content ID;
- người dùng vẫn được xem dữ liệu DB đã lưu khi provider/cookie đang lỗi, nhưng UI
  phải ghi rõ đây không phải kết quả live.

Prototype là layout reference, không phải nguồn chuẩn tích hợp. Dòng copy cũ nói
Douyin list metadata bằng yt-dlp đã bị thay thế bởi browser discovery adapter
trong tài liệu này. Không sửa prototype archive để làm nó giống implementation.

## 11. Watchlist scheduler

- Scheduler chọn watchlist `ACTIVE` có `next_run_at <= now()`.
- Dùng advisory lock/row lock để một watchlist không chạy hai lần.
- Tạo `discovery_run` mode `WATCHLIST`, bên trong delegate sang `CREATOR` hoặc
  `MIX`.
- Dừng sớm khi gặp một khoảng item đã biết liên tiếp, nhưng chỉ sau khi pagination
  đã được kiểm chứng cho provider mode đó.
- Thành công cập nhật `last_success_at`, cursor và `next_run_at`.
- Captcha/expired cookie chuyển watchlist sang `CREDENTIAL_REQUIRED`; không retry
  nóng.
- Lỗi transient dùng exponential backoff có jitter và giới hạn lần thử.
- Khi phát hiện content mới, phát domain event; Notifications có thể thông báo sau.

## 12. Bảo mật

1. File Netscape upload tối đa theo cấu hình và parse streaming.
2. Chỉ import cookie có domain chính xác `douyin.com` hoặc subdomain hợp lệ.
3. Ciphertext dùng authenticated encryption; key không nằm trong PostgreSQL.
4. Cookie plaintext chỉ tồn tại trong memory hoặc temp file mode `0600` khi công
   cụ ngoài bắt buộc; temp file phải xóa trong `finally`.
5. Không log request header, raw cookie, `a_bogus`, `msToken`, `verifyFp`, signed
   media URL hoặc toàn bộ query string.
6. Validate URL input bằng parser và allowlist; không fetch URL tùy ý để tránh SSRF.
7. Giới hạn redirect và kiểm tra lại hostname sau mỗi redirect, gồm short link.
8. Browser context không dùng chung giữa hai source account.
9. Raw payload có retention ngắn và quyền đọc hạn chế.
10. Không commit fixture thật; fixture test phải thay ID, nickname, caption và URL.

File cookie ngoài repo do operator giữ cũng phải có permission `0600`.

## 13. Rate limit, captcha và health

### 13.1 Chính sách request

- Tối đa một active browser run trên mỗi account.
- Global concurrency cấu hình được; MVP mặc định 1.
- Không refresh vô hạn; mỗi run có page/item/time budget.
- Khoảng nghỉ có jitter giữa navigation/scroll.
- Dừng ngay khi phát hiện captcha hoặc risk code.
- Cooldown tăng dần; chỉ operator mới reset credential-required state.

### 13.2 Error code nội bộ

```text
DOUYIN_CREDENTIAL_EXPIRED
DOUYIN_CAPTCHA_REQUIRED
DOUYIN_RATE_LIMITED
DOUYIN_RESPONSE_SCHEMA_CHANGED
DOUYIN_NAVIGATION_TIMEOUT
DOUYIN_UNSUPPORTED_INPUT
DOUYIN_CONTENT_UNAVAILABLE
DOUYIN_INGEST_COOKIE_NOT_FRESH
DISCOVERY_PAGE_LIMIT_REACHED
```

### 13.3 Metrics/log

- run duration và page count;
- items fetched/new/updated/skipped;
- endpoint kind, không log full URL;
- captcha/rate-limit count theo account ID nội bộ;
- normalization error count theo schema version;
- last successful validation/discovery;
- ingest preflight success/failure.

## 14. Retention

| Dữ liệu | Retention |
| --- | --- |
| Source content/creator/category | Dài hạn, soft availability |
| Metrics snapshots | Sampling/rollup sau 90 ngày |
| Remote media candidates | Giữ latest + candidates dùng bởi active ingest |
| Raw provider events | 14 ngày mặc định |
| Discovery runs/items | Tối thiểu 180 ngày; đánh giá theo volume |
| Credential phiên bản cũ | Revoke và purge theo security policy |
| R2 raw asset | Theo policy chung của video/publishing |

## 15. Testing

### 15.1 Unit

- mapper cho video, note, live, slides và unknown;
- null metrics không thành zero;
- ID lớn luôn là string;
- URL canonicalization và signed-query stripping;
- cookie parser chỉ nhận domain allowlist;
- error sanitizer không làm lộ token;
- category/mix/creator cursor round-trip;
- dedupe/upsert/idempotency.

### 15.2 Repository/integration

- Prisma constraints và indexes;
- transaction rollback khi một mapper item lỗi;
- fake provider chạy hết orchestration không cần mạng;
- HTTP contract cho create run, list result và bulk ingest;
- concurrent bulk ingest chỉ tạo một active job;
- watchlist lock và backoff.

### 15.3 Live smoke test

Test thật phải opt-in bằng env và không chạy trên PR mặc định:

- account test riêng, cookie lấy từ secret store;
- Jingxuan all trả ít nhất một normalized item;
- một category trả đúng category relation;
- creator page có cursor hoặc kết thúc hợp lệ;
- course trả offset tăng;
- captcha được map đúng, không retry loop;
- yt-dlp ingest preflight dùng cookie vừa refresh;
- không snapshot raw ID/nickname/caption vào artifact CI.

## 16. Kế hoạch triển khai theo slice

### Slice 1 — Persistence và fake provider

- Thêm Prisma và migration cho account, credential metadata, creator, content,
  metrics, run và item.
- Chưa lưu ciphertext thật nếu credential slice chưa có key management.
- Tạo provider port, normalizer và fake fixtures đã sanitize.
- Hoàn tất API create/list run bằng fake provider.

### Slice 2 — Credential import/health

- Multipart Netscape import, domain filtering, AEAD encryption và rotation.
- Validate bằng browser session read-only.
- UI account selector, upload và health state.

### Slice 3 — Jingxuan/category/course

- Playwright adapter và response allowlist.
- Dynamic categories + fallback seed.
- Module feed pagination budget.
- Course tag/video offset pagination.
- Persist run/items và render table.

### Slice 4 — Creator/link resolver

- Resolve long/short URL an toàn.
- Profile + aweme post pagination.
- Video URL metadata.
- Collection/mix chỉ bật sau fixture/smoke test.

### Slice 5 — Selection → ingest

- Bulk selection và idempotency key.
- Tạo `videos` + ingest job.
- Export fresh session cookie vào temp file `0600` cho yt-dlp preflight.
- R2 raw asset verification trước khi đánh dấu ingest thành công.

### Slice 6 — Watchlist

- CRUD, scheduler, lock, cursor, early-stop và notification event.

### Slice 7 — Search experimental

- Feature flag mặc định off.
- Video/user search, cursor và captcha UX.
- Chỉ bật khi live smoke test ổn định qua nhiều phiên.

## 17. Acceptance criteria tổng

1. Không có plaintext cookie hoặc signed request URL trong DB/log/git.
2. Jingxuan all/category/course và creator tạo kết quả DB đã dedupe.
3. Refresh cùng nguồn không tạo duplicate `source_contents`.
4. Metrics thay đổi tạo snapshot, không ghi đè lịch sử.
5. Live/ad/unsupported content không tạo ingest job.
6. Bulk ingest retry không tạo hai active job cho một source content.
7. Cookie expired, captcha và schema drift có error code/UX riêng.
8. UI pagination hoàn toàn qua API/DB cursor, không dùng cursor Douyin trực tiếp.
9. Watchlist tạo audit run và phát hiện được item mới.
10. yt-dlp listing không được dùng cho creator Douyin; ingest phải có fresh-cookie
    preflight.

## 18. Open validation gates

Các mục sau không được coi là hoàn tất chỉ dựa trên bundle analysis:

- sample thật cho collection/mix và pagination;
- sample note/slides/long-video để chốt ingest eligibility;
- độ bền của cookie được refresh từ Playwright khi đưa sang yt-dlp;
- duration unit trên tất cả content type;
- search sau captcha trong account test;
- giới hạn request an toàn theo thời gian và account.

Những gate này không cản Slice 1–3, nhưng cản việc bật production cho mode liên
quan.
