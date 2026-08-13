import { useState } from 'react';
import { Menu, Sparkles } from 'lucide-react';
import NotificationSidebar from './components/Sidebar/NotificationSidebar.jsx';
import NetworkGraph from './components/Graph/NetworkGraph.jsx';
import data from './data/hololiveData.json';

export default function App() {
  const [mobileFeedOpen, setMobileFeedOpen] = useState(false);
  const membersById = Object.fromEntries(data.members.map((m) => [m.id, m]));

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
          <Sparkles size={18} className="text-[#7c5cff]" />
          <span className="font-display text-lg font-bold tracking-tight">HOLONET</span>
          <span className="hidden text-xs text-ink-500 sm:inline">홀로라이브 알림 &amp; 교류 네트워크</span>
        </div>
        <span className="rounded-full border border-stage-border px-2.5 py-1 text-[11px] text-ink-500">
          멤버 {data.members.length}명 · 교류 {data.edges.length}건
        </span>
      </header>

      {/* 본문: 사이드바 + 그래프 */}
      <div className="flex min-h-0 flex-1">
        <NotificationSidebar
          notifications={data.notifications}
          membersById={membersById}
          isOpen={mobileFeedOpen}
          onClose={() => setMobileFeedOpen(false)}
        />
        <main className="relative min-w-0 flex-1 bg-stage-900">
          <NetworkGraph members={data.members} edges={data.edges} notifications={data.notifications} />
        </main>
      </div>
    </div>
  );
}
