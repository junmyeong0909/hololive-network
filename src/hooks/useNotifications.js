import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 60_000;

/*
 * 아카이브(음악 205건 + 지난 라이브 3995건 + 합방 448건)는 응답의 대부분인 1.6MB를
 * 차지하는데, 하루에 몇 건 늘 뿐이라 60초마다 다시 받을 이유가 없다. 실제로 폴링에
 * 필요한 건 notifications와 liveCollabs(합쳐 8KB)뿐이다.
 *
 * 매 폴링마다 1.6MB를 받아 파싱(폰 기준 75~125ms)하고 4천 건짜리 배열을 새로 만들어
 * 정렬하던 것이 렉의 원인이었다. 첫 로드에서 전체를 받고 이후 폴링은 light로 돌린다.
 * 다만 새로 올라온 곡·방송이 새로고침 없이도 들어오도록 이 횟수마다 한 번은 전체를 받는다.
 */
const FULL_REFRESH_EVERY = 10; // 10회 x 60초 = 10분

// 3단계에서 Worker 주소를 .env의 VITE_FEED_ENDPOINT에 넣으면 실데이터로 전환된다.
// 비어 있으면 fallback(더미)을 그대로 쓴다.
const FEED_ENDPOINT = import.meta.env.VITE_FEED_ENDPOINT ?? '';

/**
 * 알림 피드를 주기적으로 가져온다.
 *
 * - 엔드포인트가 없으면 fallback을 그대로 반환 (source: 'dummy')
 * - 갱신 실패 시 마지막으로 성공한 데이터를 유지한다 (화면이 비지 않게)
 * - 최초 로드부터 실패하면 빈 목록 (더미로 되돌리지 않는다 —
 *   가짜를 진짜처럼 보여주는 게 빈 화면보다 나쁘다)
 */
export function useNotifications(fallback = []) {
  const enabled = Boolean(FEED_ENDPOINT);

  const [notifications, setNotifications] = useState(enabled ? [] : fallback);
  // 곡 아카이브 (Worker가 KV에 무한 누적한 목록). 더미 모드에서는 없다.
  const [music, setMusic] = useState([]);
  // 지난 라이브 아카이브 (역시 KV에 무한 누적). LIVE 탭에서 과거 방송까지 보여주는 데 쓴다.
  const [streams, setStreams] = useState([]);
  // 합방 아카이브 + 지금 진행 중인 합방 그룹
  const [interactions, setInteractions] = useState([]);
  const [liveCollabs, setLiveCollabs] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [isStale, setIsStale] = useState(false); // 갱신 실패로 옛 데이터를 보여주는 중
  const [isLoading, setIsLoading] = useState(enabled);

  // 한 번이라도 성공했는지 (최초 실패와 갱신 실패를 구분하기 위해)
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async (signal, { full = false } = {}) => {
    if (!enabled) return;
    try {
      // light 응답에는 music/streams/interactions가 아예 없다. 아래 setter들이
      // Array.isArray로 가드하고 있어서, 없으면 기존 상태를 그대로 유지한다.
      const url = full
        ? FEED_ENDPOINT
        : `${FEED_ENDPOINT}${FEED_ENDPOINT.includes('?') ? '&' : '?'}light=1`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!Array.isArray(data?.notifications)) throw new Error('예상과 다른 응답 형식');

      setNotifications(data.notifications);
      if (Array.isArray(data.music)) setMusic(data.music);
      if (Array.isArray(data.streams)) setStreams(data.streams);
      if (Array.isArray(data.interactions)) setInteractions(data.interactions);
      // 진행 중인 합방이 없으면 빈 배열이 정상이므로 그대로 반영한다
      setLiveCollabs(Array.isArray(data.liveCollabs) ? data.liveCollabs : []);
      setUpdatedAt(data.updatedAt ?? new Date().toISOString());
      setIsStale(false);
      hasLoadedRef.current = true;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // 성공 이력이 있으면 기존 데이터를 유지한 채 '갱신 실패'만 표시
      setIsStale(true);
      if (!hasLoadedRef.current) setNotifications([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    // 첫 로드만 전체(아카이브 포함)를 받는다
    refresh(controller.signal, { full: true });

    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      refresh(controller.signal, { full: polls % FULL_REFRESH_EVERY === 0 });
    }, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, refresh]);

  return {
    notifications,
    music,
    streams,
    interactions,
    liveCollabs,
    updatedAt,
    isStale,
    isLoading,
    source: enabled ? 'live' : 'dummy',
    // 수동 새로고침은 아카이브까지 최신으로 받는다
    refresh: () => refresh(undefined, { full: true }),
  };
}
