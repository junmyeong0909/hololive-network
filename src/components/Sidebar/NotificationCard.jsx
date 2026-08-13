import { motion } from 'framer-motion';
import { ExternalLink, Radio, Music2, MessageCircle } from 'lucide-react';
import MemberAvatar from '../MemberAvatar.jsx';

const TYPE_META = {
  tweet: { icon: MessageCircle, label: '트윗' },
  live: { icon: Radio, label: '생방송' },
  cover: { icon: Music2, label: '커버' },
};

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default function NotificationCard({ notification, member, index }) {
  const meta = TYPE_META[notification.type];
  const Icon = meta.icon;

  return (
    <motion.a
      href={notification.url}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.25 }}
      className="group flex gap-3 rounded-2xl border border-stage-border bg-stage-700/60 p-3 transition-colors hover:border-sky-400/50 hover:bg-stage-600/60"
    >
      <MemberAvatar member={member} className="h-10 w-10" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink-100">{member?.name ?? '알 수 없음'}</span>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-stage-800 px-2 py-0.5 text-[10px] font-medium text-ink-500">
            <Icon size={11} /> {meta.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-ink-300">{notification.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink-500">{notification.snippet}</p>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] text-ink-500">{timeAgo(notification.timestamp)}</span>
          <ExternalLink size={12} className="text-ink-500 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </motion.a>
  );
}
