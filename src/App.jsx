import { useMemo, useState } from 'react';
import { Menu, Sparkles, Moon, Sun } from 'lucide-react';
import NotificationSidebar from './components/Sidebar/NotificationSidebar.jsx';
import NetworkGraph from './components/Graph/NetworkGraph.jsx';
import { useNotifications } from './hooks/useNotifications.js';
import { useTheme } from './hooks/useTheme.js';
import data from './data/hololiveData.json';
import channelIds from './data/channelIds.json';
import memberSongs from './data/memberSongs.json';
import seedInteractions from './data/memberInteractions.json';

export default function App() {
  const [mobileFeedOpen, setMobileFeedOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const { theme, toggle } = useTheme();

  const {
    notifications,
    music,
    interactions: liveInteractions,
    liveCollabs,
    isStale,
    source,
  } = useNotifications(data.notifications);

  // 채널 ID는 스크립트로 생성되는 별도 파일이라 여기서 합쳐준다 (툴팁의 채널 링크용)
  const members = useMemo(
    () => data.members.map((m) => ({ ...m, youtubeChannelId: channelIds[m.id] })),
    []
  );
  const membersById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);

  /**
   * 실시간 피드(라이브·예정·최근 영상) + 곡 아카이브(무한 누적)를 합친다.
   * 곡 아카이브는 Worker가 KV에 계속 쌓아온 전체 목록이라 그 자체로
   * 활동이 뜸한 멤버까지 포함하므로, 더미 정적 파일을 따로 병합할 필요가 없다.
   * (Worker가 없는 더미 모드에서만 로컬 memberSongs.json으로 보완한다.)
   * 같은 영상이 양쪽에 있으면 실시간 쪽을 남긴다(라이브 상태 등 최신 정보 유지).
   */
  const allNotifications = useMemo(() => {
    const seen = new Set(notifications.map((n) => n.id));
    const archive = source === 'live' ? music : memberSongs;
    return [...notifications, ...archive.filter((s) => !seen.has(s.id))];
  }, [notifications, music, source]);

  // 그래프 노드에 LIVE 표시를 하기 위한 집합. 곡 아카이브는 전부 status:'past'라
  // 여기 섞여도 무해하지만, 굳이 합칠 필요 없이 실시간 알림에서만 뽑는다.
  const liveMemberIds = useMemo(
    () => new Set(notifications.filter((n) => n.status === 'live').map((n) => n.memberId)),
    [notifications]
  );

  // 합방 기록: Worker(KV 누적)가 있으면 그걸 쓰고, 없으면 저장소의 시드로 대체.
  // hololiveData.json의 interactions는 더미 제거 후 빈 배열이라 더는 쓰지 않는다.
  const rawInteractions = source === 'live' ? liveInteractions : seedInteractions;

  /*
   * 폴링(60초)마다 같은 내용이라도 새 배열 객체가 오는데, 그대로 넘기면
   * NetworkGraph의 메인 effect가 매번 재실행되어 그래프를 통째로 다시 그린다
   * (= 사용자가 맞춰둔 줌·위치가 리셋된다). 내용이 실제로 바뀌었을 때만
   * 새 참조를 내려보낸다.
   */
  const interactionsKey = rawInteractions.map((i) => i.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const interactions = useMemo(() => rawInteractions, [interactionsKey]);

  const selectedMember = selectedMemberId ? membersById[selectedMemberId] : null;
  const feedNotifications = selectedMemberId
    ? allNotifications.filter((n) => n.memberId === selectedMemberId)
    : allNotifications;

  const isDark = theme === 'dark';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden font-body text-ink-100">
      {/* 상단 헤더 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-stage-border bg-stage-800/70 px-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileFeedOpen(true)}
            className="rounded-lg p-1.5 text-ink-300 hover:bg-stage-700 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <Sparkles size={18} className="text-sky-500" />
          <span className="font-display text-lg font-bold tracking-tight">HOLONET</span>
          <span className="hidden text-xs text-ink-500 sm:inline">홀로라이브 알림 &amp; 교류 네트워크</span>
        </div>

        <div className="flex items-center gap-2">
          {source === 'dummy' && (
            <span className="rounded-full border border-amber-400/50 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-300">
              샘플 데이터
            </span>
          )}
          {isStale && (
            <span className="rounded-full border border-red-400/50 bg-red-400/10 px-2.5 py-1 text-[11px] font-medium text-red-600 dark:text-red-300">
              갱신 실패
            </span>
          )}
          <span className="hidden rounded-full border border-stage-border px-2.5 py-1 text-[11px] text-ink-500 sm:inline">
            멤버 {members.length}명 · 교류 기록 {interactions.length}건
          </span>

          <button
            onClick={toggle}
            title={isDark ? '밝은 테마로' : '어두운 테마로'}
            aria-label={isDark ? '밝은 테마로 전환' : '어두운 테마로 전환'}
            className="rounded-lg border border-stage-border p-1.5 text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100"
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* 본문: 사이드바 + 그래프 */}
      <div className="flex min-h-0 flex-1">
        <NotificationSidebar
          notifications={feedNotifications}
          membersById={membersById}
          isOpen={mobileFeedOpen}
          onClose={() => setMobileFeedOpen(false)}
          selectedMember={selectedMember}
          onClearSelection={() => setSelectedMemberId(null)}
        />
        <main className="relative min-w-0 flex-1 bg-stage-900">
          <NetworkGraph
            members={members}
            interactions={interactions}
            liveMemberIds={liveMemberIds}
            liveCollabs={liveCollabs}
            selectedMemberId={selectedMemberId}
            onSelectMember={setSelectedMemberId}
          />
        </main>
      </div>
    </div>
  );
}
