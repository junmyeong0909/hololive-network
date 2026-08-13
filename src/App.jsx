import { useState } from 'react';
import { Menu, Sparkles } from 'lucide-react';
import NotificationSidebar from './components/Sidebar/NotificationSidebar.jsx';
import NetworkGraph from './components/Graph/NetworkGraph.jsx';
import data from './data/hololiveData.json';

export default function App() {
  const [mobileFeedOpen, setMobileFeedOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const membersById = Object.fromEntries(data.members.map((m) => [m.id, m]));
  const selectedMember = selectedMemberId ? membersById[selectedMemberId] : null;
  const feedNotifications = selectedMemberId
    ? data.notifications.filter((n) => n.memberId === selectedMemberId)
    : data.notifications;

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
        <span className="rounded-full border border-stage-border px-2.5 py-1 text-[11px] text-ink-500">
          멤버 {data.members.length}명 · 교류 기록 {data.interactions.length}건
        </span>
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
            members={data.members}
            interactions={data.interactions}
            notifications={data.notifications}
            selectedMemberId={selectedMemberId}
            onSelectMember={setSelectedMemberId}
          />
        </main>
      </div>
    </div>
  );
}
