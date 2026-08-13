import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, X, MessageCircle, Radio, Music2 } from 'lucide-react';
import NotificationCard from './NotificationCard.jsx';

const TABS = [
  { id: 'all', label: '전체', icon: Bell },
  { id: 'tweet', label: '트윗', icon: MessageCircle },
  { id: 'live', label: '생방송', icon: Radio },
  { id: 'cover', label: '커버', icon: Music2 },
];

export default function NotificationSidebar({ notifications, membersById, isOpen, onClose, selectedMember, onClearSelection }) {
  const [activeTab, setActiveTab] = useState('all');

  const filtered = useMemo(() => {
    const list = activeTab === 'all' ? notifications : notifications.filter((n) => n.type === activeTab);
    return [...list].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [notifications, activeTab]);

  const body = (
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
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-display font-semibold text-slate-900"
              style={{ backgroundColor: selectedMember.color }}
            >
              {selectedMember.initials}
            </span>
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
            </button>
          );
        })}
      </div>

      <div className="feed-scroll flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        <AnimatePresence mode="popLayout">
          {filtered.map((n, i) => (
            <NotificationCard key={n.id} notification={n} member={membersById[n.memberId]} index={i} />
          ))}
        </AnimatePresence>
        {filtered.length === 0 && (
          <p className="pt-8 text-center text-sm text-ink-500">해당 카테고리의 알림이 없어요.</p>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* 데스크톱: 고정 사이드바 */}
      <aside className="hidden h-full w-[360px] shrink-0 border-r border-stage-border bg-stage-800/70 backdrop-blur lg:flex">
        {body}
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
              {body}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
