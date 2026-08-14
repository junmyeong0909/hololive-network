# YouTube 활동 피드 설계

작성일: 2026-08-14

## 1. 목표

멤버들의 **YouTube 활동**(생방송, 예정 방송, 커버·오리지널 곡, 신규 영상)을
실시간에 가깝게 가져와 좌측 피드에 표시한다.

X(트위터)는 **범위에서 제외**한다. 이유는 부록 A 참조.

## 2. 탭 구조

기존 `전체 / 트윗 / 생방송 / 커버` → YouTube 활동 중심으로 재편한다.

| 탭 | 필터 | 설명 |
|---|---|---|
| 전체 | 없음 | 최신순 통합 (단, 라이브는 항상 최상단) |
| 🔴 LIVE | `status === 'live'` | 지금 방송 중 |
| 예정 | `status === 'upcoming'` | 예정된 방송 (48시간 내) |
| 음악 | `topic === 'singing'` | 커버 + 오리지널 신곡 |

각 탭이 단일 조건으로 떨어져서 로직이 단순하다.
"음악"은 상태와 무관하게 걸러지므로 음악 방송 예정도 함께 잡힌다.

## 3. 제약

1. **GitHub Pages는 정적 호스팅** — 서버가 없어 API 키를 숨길 곳이 없다.
   브라우저로 내려가는 순간 공개되므로 중간 계층이 필수다.
2. **YouTube 공식 Data API는 못 쓴다** — 라이브 감지용 `search.list`가 호출당
   100유닛이라 29명을 5분 주기로 돌리면 하루 83만 유닛. 무료 쿼터(1만/일)의 83배다.
3. **Cloudflare KV 무료 쓰기는 하루 1,000회** — 1분 cron(1,440회/일)은 한도 초과.

## 4. 아키텍처

제약 3번 때문에 "Cron + KV"가 아니라 **요청 시점 조회 + 엣지 캐시**로 간다.
부품이 적어 고장 지점이 줄고, KV 쓰기 한도와 cron 지연 문제가 사라진다.

```
[GitHub Pages 사이트]
        │  60초 폴링
        ▼
[Cloudflare Worker]  GET /api/feed
        │
   엣지 캐시 60초 ── hit ──> 즉시 응답
        │ miss
        ▼
   Holodex API  (키는 Worker secret)
```

- Worker 무료 한도 10만 req/일 — 개인 사이트에는 충분
- 갱신 지연 60초 이내
- Holodex 키는 브라우저에 노출되지 않는다

### 향후: WebSub 푸시

YouTube는 WebSub로 라이브 시작 시 콜백을 밀어준다. 쿼터 무료.
지연을 60초 → 즉시로 줄이려면 이때 KV를 도입한다.

## 5. 데이터 소스

Holodex는 홀로라이브 전용 집계 서비스라 우리 용도에 정확히 맞는다.

| 용도 | 엔드포인트 |
|---|---|
| 라이브 + 예정 | `/users/live?channels=<29개 채널ID>` |
| 음악 | `/videos?topic=singing&channel_id=...&status=past` |
| 최근 영상 | `/videos?channel_id=...&status=past&limit=...` |

인증은 `X-APIKEY` 헤더. 무료 키.

## 6. API 계약

```
GET https://<worker>.workers.dev/api/feed
Access-Control-Allow-Origin: https://junmyeong0909.github.io
```

```jsonc
{
  "updatedAt": "2026-08-14T12:34:56Z",
  "notifications": [
    {
      "id": "yt:dQw4w9WgXcQ",      // 소스 접두사로 충돌 방지
      "memberId": "suisei",
      "type": "stream",             // stream | music | video
      "status": "live",             // live | upcoming | past
      "title": "방송 제목",
      "snippet": "보조 정보",
      "timestamp": "2026-08-14T12:00:00Z",  // 시작(예정) 시각
      "url": "https://youtube.com/watch?v=...",
      "thumbnail": "https://i.ytimg.com/vi/.../mqdefault.jpg",
      "liveViewers": 12345          // 라이브일 때만
    }
  ]
}
```

`type`(내용 종류)과 `status`(생명주기)를 분리했다. 하나로 합치면
"음악 방송이 지금 라이브"인 경우를 표현할 수 없다.

## 7. 데이터 모델 변경

현재 `hololiveData.json`에 **채널 ID가 없다.** 알림 URL에 핸들만 있어서
(`youtube.com/@HoshimachiSuisei`) API 조회에 쓸 수 없다.

```jsonc
{
  "id": "suisei",
  "nameEn": "Hoshimachi Suisei",
  "youtubeChannelId": "UC5CwaMl1eIgY8h02uZw7u8A"   // 추가
}
```

**확보 방법**: Holodex `/channels?org=Hololive&limit=100`을 한 번 호출해
`nameEn`으로 자동 매칭하는 일회성 스크립트를 만들고 **결과를 JSON에 커밋**한다.
런타임 비용 0.

기존 `notifications` 더미 15건은 제거한다. 실패 시 더미로 되돌리지 않는다
— 가짜를 진짜처럼 보여주는 게 빈 화면보다 나쁘다.

## 8. 프론트엔드 변경

- `useNotifications()` 훅 — 60초 폴링, 마운트 시 즉시 1회
- 라이브는 **빨간 LIVE 뱃지 + 목록 최상단 고정**, 동시 시청자 수 표시
- 예정은 "3시간 후 시작" 형태로 상대 시각 표시
- 카드에 썸네일 추가
- 탭 아이콘 교체 (트윗용 MessageCircle 제거)

## 9. 실패 처리

| 상황 | 동작 |
|---|---|
| Worker 응답 실패 | 마지막 성공 데이터 유지 + "갱신 실패" 표시 |
| Holodex 장애 | Worker가 캐시된 마지막 응답 반환 |
| 방송 없음 | "현재 방송 중인 멤버가 없어요" |
| 최초 로드 실패 | 빈 상태 안내 (더미 폴백 안 함) |

## 10. 구현 단계

| 단계 | 내용 | 선행 조건 |
|---|---|---|
| 1 | 탭 재편 + 훅/뱃지 스캐폴딩 (더미로 동작 확인) | 없음 |
| 2 | 멤버 29명 채널 ID 매핑 | Holodex 키 |
| 3 | Worker 작성 + 배포 (라이브·예정) | Cloudflare 계정 |
| 4 | 음악 탭 연동 | 3단계 |
| 5 | WebSub 푸시로 지연 단축 (선택) | 4단계 |
| 6 | **실제 합방 데이터로 네트워크 그래프 구동** (아래 참조) | 3단계 |

1단계는 계정 없이 진행 가능하므로 준비와 병행할 수 있다.

### 6단계가 중요한 이유

지금 네트워크 그래프의 `interactions`는 **전부 손으로 만든 가짜 데이터**다.
Holodex에 `/channels/{channelId}/collabs`가 있어서, 해당 채널이 다른 멤버 영상에
출연한 기록을 가져올 수 있다. 이걸 쓰면 합방 그래프를 실제 데이터로 돌릴 수 있고,
날짜도 같이 오므로 이미 만들어둔 **시간 감쇠 로직이 그대로 작동한다.**

## 11. 비용

| 항목 | 비용 |
|---|---|
| Cloudflare Workers | 무료 (10만 req/일) |
| Holodex API | 무료 (키 발급 필요) |
| GitHub Pages / Actions | 무료 (공개 저장소) |
| **합계** | **무료** |

## 12. 사전 준비 (수동)

1. Cloudflare 계정 생성
2. holodex.net 로그인 → Account Settings에서 API 키 발급
3. `wrangler login`
4. `wrangler secret put HOLODEX_API_KEY`

---

## 부록 A. X(트위터)를 제외한 이유

재검토 방지를 위해 기록해둔다.

### 공식 API
- 무료 티어가 **2026년 2월 폐지**. 신규는 pay-per-use만 가능
- 읽기 트윗당 $0.005 → 29명 기준 **월 $25~60**
- 구 Basic($200/월)·Pro($5,000/월)는 신규 가입 차단

### 크롤링
- 게스트 접근 폐지. 2025년 1월부터 guest token이 브라우저 지문에 바인딩되고
  **데이터센터 IP 영구 차단**
- `snscrape`, `Twint`, `Nitter` 전부 사망 (모두 익명 게스트 접근에 의존했음)
- 현재 하려면 Playwright + 레지던셜 프록시 + 실제 로그인 계정 필요
- **Cloudflare Worker는 헤드리스 브라우저를 못 돌린다.** Browser Rendering은
  유료 전용이고, 쓰더라도 데이터센터 IP라 차단된다 → 무료 설계가 무너짐
- 실제 계정 쿠키 사용 시 계정 정지 위험
- X가 2~4주마다 방어 로직을 변경해 DIY 스크래퍼가 지속적으로 깨짐

### syndication 엔드포인트 (임베드 위젯용)
- `syndication.twitter.com/srv/timeline-profile/screen-name/<user>`
- 인증 불필요, 최근 ~12개, 평범한 fetch라 Worker 구조에는 맞았음
- 그러나 실제 호출 테스트 결과 **HTTP 429 (Too Many Requests)**
  → 데이터센터 IP에서는 강하게 제한됨. Worker도 같은 벽에 부딪힐 가능성 높음
- 비공식 엔드포인트라 예고 없이 사라질 수 있고 ToS 회색지대

### 결론
비용·안정성·구조 적합성 모두에서 부적합. YouTube만으로도 활동의 대부분이 커버된다.
나중에 다시 필요해지면 **공식 임베드 위젯(iframe)** 이 가장 안전한 선택지다.
