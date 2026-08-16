import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, X, Radio, Music2, Clock, Users } from 'lucide-react';
import NotificationCard from './NotificationCard.jsx';
import MemberAvatar from '../MemberAvatar.jsx';
import { extractTags } from '../../lib/topicExtract.js';

const TABS = [
  { id: 'all', label: '전체', icon: Bell, match: () => true },
  { id: 'live', label: 'LIVE', icon: Radio, match: (n) => n.status === 'live' },
  { id: 'upcoming', label: '예정', icon: Clock, match: (n) => n.status === 'upcoming' },
  { id: 'music', label: '음악', icon: Music2, match: (n) => n.type === 'music' },
];

// 라이브 > 예정 > 지난 순으로 묶는다
const STATUS_ORDER = { live: 0, upcoming: 1 };
const statusRank = (n) => STATUS_ORDER[n.status] ?? 2;

function compareNotifications(a, b) {
  const rankDiff = statusRank(a) - statusRank(b);
  if (rankDiff !== 0) return rankDiff;

  // 예정은 임박한 순, 나머지는 최신 순
  const ta = new Date(a.timestamp).getTime();
  const tb = new Date(b.timestamp).getTime();
  return a.status === 'upcoming' ? ta - tb : tb - ta;
}

const EMPTY_MESSAGE = {
  all: '표시할 활동이 없어요.',
  live: '지금 방송 중인 멤버가 없어요.',
  upcoming: '예정된 방송이 없어요.',
  music: '최근 올라온 음악이 없어요.',
};

// 곡 아카이브가 무한 누적이라 한 번에 다 그리면 DOM이 계속 무거워진다.
// 스크롤이 바닥에 닿을 때마다 이만큼씩 더 보여준다.
const PAGE_SIZE = 20;

/**
 * 스크롤 컨테이너 바닥의 sentinel이 보이면 다음 페이지를 더 노출한다.
 * 데이터는 이미 다 받아와 있으므로(App.jsx에서 병합 완료) 여긴 렌더링
 * 개수만 늘린다 — 네트워크 요청 없이 즉시 반응한다.
 *
 * 데스크톱/모바일 두 벌의 피드 UI가 동시에 DOM에 존재할 수 있어서(반응형
 * CSS로 한쪽만 숨김) 컨테이너별로 독립된 ref가 필요하다. 하나의 ref를
 * 두 곳에서 같이 쓰면 나중에 마운트된 쪽이 앞쪽 ref를 덮어써 스크롤
 * 초기화가 엉뚱한 곳에 걸린다.
 */
function useInfiniteScroll({ scrollRef, sentinelRef, hasMore, onLoadMore }) {
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { root, rootMargin: '300px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scrollRef, sentinelRef, hasMore, onLoadMore]);
}

function FeedBody({
  visible,
  filtered,
  groups,
  hasMore,
  membersById,
  selectedMember,
  onClearSelection,
  onClose,
  activeTab,
  setActiveTab,
  liveCount,
  scrollRef,
  sentinelRef,
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <h2 className="font-display text-base font-semibold tracking-tight text-ink-100">알림 피드</h2>
        <button onClick={onClose} className="rounded-full p-1.5 text-ink-500 hover:bg-stage-700 hover:text-ink-100 lg:hidden">
          <X size={18} />
        </button>
      </div>

      {selectedMember && (
        <div className="mx-4 mb-3 flex items-center justify-between gap-2 rounded-xl border border-stage-border bg-stage-700/60 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <MemberAvatar member={selectedMember} className="h-6 w-6" textClassName="text-[10px]" />
            <span className="truncate text-xs text-ink-300">
              <span className="font-semibold text-ink-100">{selectedMember.name}</span> 알림만 보는 중
            </span>
          </div>
          <button
            onClick={onClearSelection}
            className="shrink-0 rounded-full p-1 text-ink-500 hover:bg-stage-600 hover:text-ink-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex gap-1.5 px-4 pb-3">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-sky-500 text-white'
                  : 'bg-stage-700 text-ink-300 hover:bg-stage-600'
              }`}
            >
              <Icon size={13} />
              {tab.label}
              {tab.id === 'live' && liveCount > 0 && (
                <span
                  className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold ${
                    active ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
                  }`}
                >
                  {liveCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div ref={scrollRef} className="feed-scroll flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-4 pb-4">
        {/* 예정 탭에서는 같은 기획(공통 태그)끼리 묶어서 합방임이 드러나게 한다 */}
        {groups.map((g) => (
          <div
            key={g.topic}
            className="rounded-2xl border border-sky-400/40 bg-sky-500/5 p-2"
          >
            <div className="flex items-center gap-1.5 px-1 pb-1.5">
              <Users size={12} className="shrink-0 text-sky-700 dark:text-sky-400" />
              <span className="truncate text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                {g.topic}
              </span>
              <span className="shrink-0 text-[10px] text-ink-500">{g.items.length}명 합방</span>
            </div>
            <div className="space-y-1.5">
              {g.items.map((n, i) => (
                <NotificationCard
                  key={n.id}
                  notification={n}
                  member={membersById[n.memberId]}
                  index={i}
                />
              ))}
            </div>
          </div>
        ))}

        <AnimatePresence mode="popLayout">
          {visible.map((n, i) => (
            <NotificationCard key={n.id} notification={n} member={membersById[n.memberId]} index={i} />
          ))}
        </AnimatePresence>

        {filtered.length === 0 && groups.length === 0 && (
          <p className="pt-8 text-center text-sm text-ink-500">
            {selectedMember ? '이 멤버의 활동이 없어요.' : EMPTY_MESSAGE[activeTab]}
          </p>
        )}

        {hasMore && <div ref={sentinelRef} aria-hidden className="h-4" />}

        {!hasMore && filtered.length > PAGE_SIZE && (
          <p className="py-3 text-center text-[11px] text-ink-500">모두 불러왔어요 · 총 {filtered.length}건</p>
        )}
      </div>
    </div>
  );
}

export default function NotificationSidebar({ notifications, membersById, isOpen, onClose, selectedMember, onClearSelection }) {
  const [activeTab, setActiveTab] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 데스크톱/모바일 컨테이너가 동시에 DOM에 있을 수 있어 ref를 따로 둔다
  const desktopScrollRef = useRef(null);
  const desktopSentinelRef = useRef(null);
  const mobileScrollRef = useRef(null);
  const mobileSentinelRef = useRef(null);

  const matched = useMemo(() => {
    const match = TABS.find((t) => t.id === activeTab)?.match ?? (() => true);
    return notifications.filter(match).sort(compareNotifications);
  }, [notifications, activeTab]);

  /*
   * 예정 탭에서는 같은 기획 태그를 공유하는 방송을 묶어 보여준다.
   * 여러 멤버가 같은 태그를 걸어두면 그게 곧 합방이라는 신호다.
   * 묶인 항목은 아래 일반 목록에서 빼서 중복 표시를 피한다.
   */
  const { groups, filtered } = useMemo(() => {
    if (activeTab !== 'upcoming') return { groups: [], filtered: matched };

    const byTag = new Map(); // 태그 -> 알림 배열
    for (const n of matched) {
      for (const tag of extractTags(n.title)) {
        const key = tag.toLowerCase();
        if (!byTag.has(key)) byTag.set(key, { tag, items: [] });
        byTag.get(key).items.push(n);
      }
    }

    // 2명 이상이 같은 태그를 건 경우만 합방으로 본다
    const picked = [...byTag.values()]
      .filter((g) => new Set(g.items.map((n) => n.memberId)).size >= 2)
      .sort((a, b) => b.items.length - a.items.length);

    // 한 방송이 여러 태그에 걸릴 수 있어서, 가장 큰 그룹에만 넣는다
    const claimed = new Set();
    const result = [];
    for (const g of picked) {
      const items = g.items.filter((n) => !claimed.has(n.id));
      if (new Set(items.map((n) => n.memberId)).size < 2) continue;
      items.forEach((n) => claimed.add(n.id));
      result.push({ topic: g.tag, items });
    }

    return { groups: result, filtered: matched.filter((n) => !claimed.has(n.id)) };
  }, [matched, activeTab]);

  const liveCount = useMemo(
    () => notifications.filter((n) => n.status === 'live').length,
    [notifications]
  );

  // 탭이나 멤버 필터가 바뀌면 처음부터 다시 (스크롤 위치도 초기화)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    desktopScrollRef.current?.scrollTo({ top: 0 });
    mobileScrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab, selectedMember?.id]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const loadMore = () => setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));

  useInfiniteScroll({ scrollRef: desktopScrollRef, sentinelRef: desktopSentinelRef, hasMore, onLoadMore: loadMore });
  useInfiniteScroll({ scrollRef: mobileScrollRef, sentinelRef: mobileSentinelRef, hasMore, onLoadMore: loadMore });

  const commonProps = {
    visible,
    filtered,
    groups,
    hasMore,
    membersById,
    selectedMember,
    onClearSelection,
    onClose,
    activeTab,
    setActiveTab,
    liveCount,
  };

  return (
    <>
      {/* 데스크톱: 고정 사이드바 */}
      <aside className="hidden h-full w-[360px] shrink-0 border-r border-stage-border bg-stage-800/70 backdrop-blur lg:flex">
        <FeedBody {...commonProps} scrollRef={desktopScrollRef} sentinelRef={desktopSentinelRef} />
      </aside>

      {/* 모바일: 슬라이드 패널 */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[360px] border-r border-stage-border bg-stage-800 lg:hidden"
            >
              <FeedBody {...commonProps} scrollRef={mobileScrollRef} sentinelRef={mobileSentinelRef} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
