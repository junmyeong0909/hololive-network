# HOLONET — 홀로라이브 알림 & 교류 네트워크

홀로라이브 멤버들의 트윗/생방송/커버곡 알림 피드와, 합방·커버곡 기반 멤버 교류 관계망을
D3-force 네트워크 그래프로 보여주는 반응형 웹 앱입니다.

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

## 폴더 구조

```
src/
  data/hololiveData.json        # 멤버 / 교류(엣지) / 알림 더미 데이터
  components/
    Sidebar/
      NotificationSidebar.jsx   # 좌측 알림 패널 (탭 필터 + 반응형 슬라이드)
      NotificationCard.jsx      # 알림 카드 아이템
    Graph/
      NetworkGraph.jsx          # D3-force 네트워크 그래프 (드래그/줌/하이라이트)
      MemberTooltip.jsx         # 노드 클릭 시 교류 정보 말풍선
  App.jsx                       # 전체 레이아웃 조립
```

## 주요 기능

- **알림 피드**: 트윗 / 생방송 / 커버 탭 필터링, 최신순 정렬, 모바일에서는 슬라이드 패널로 전환
- **네트워크 그래프**
  - 노드 크기 = 해당 멤버의 총 교류량(합방 + 커버곡 횟수)
  - 엣지 두께·불투명도 = 두 멤버 간 교류 횟수
  - 노드 드래그, 스크롤 확대/축소, 우측 하단 줌 컨트롤
  - 노드 클릭 시 연결된 멤버만 하이라이트 + 교류 목록 말풍선 표시, 배경 클릭 시 해제

## 데이터 교체하기

`src/data/hololiveData.json`의 `members` / `edges` / `notifications` 배열을
실제 API 응답 형식에 맞게 교체하면 됩니다. 실시간 연동 시에는 `App.jsx`에서
`data` import 부분을 API fetch 훅으로 바꿔주세요.

## 남은 작업 제안

- 실제 유튜브/X API 연동 (현재는 정적 더미 데이터)
- 알림 실시간 폴링/웹소켓
- 그래프 레이아웃 저장(로컬 좌표 고정) 기능
