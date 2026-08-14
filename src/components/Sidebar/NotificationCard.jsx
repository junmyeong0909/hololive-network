import { motion } from 'framer-motion';
import { ExternalLink, Radio, Music2, Video, Clock, Eye } from 'lucide-react';
import MemberAvatar from '../MemberAvatar.jsx';

const TYPE_META = {
  stream: { icon: Radio, label: '방송' },
  music: { icon: Music2, label: '음악' },
  video: { icon: Video, label: '영상' },
};

const FALLBACK_META = { icon: Video, label: '활동' };

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function timeUntil(iso) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  // 예정 시각이 지났는데 아직 시작 안 한 경우(방송 지연)도 자연스럽게 처리
  if (mins <= 0) return '곧 시작';
  if (mins < 60) return `${mins}분 후 시작`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}시간 후 시작`;
  return `${Math.round(hours / 24)}일 후 시작`;
}

export default function NotificationCard({ notification, member, index }) {
  const { status } = notification;
  const meta = TYPE_META[notification.type] ?? FALLBACK_META;
  const Icon = meta.icon;
  const isLive = status === 'live';

  return (
    <motion.a
      href={notification.url}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.25 }}
      className={`group flex gap-3 rounded-2xl border p-3 transition-colors ${
        isLive
          ? 'border-red-400/60 bg-red-500/5 hover:bg-red-500/10'
          : 'border-stage-border bg-stage-700/60 hover:border-sky-400/50 hover:bg-stage-600/60'
      }`}
    >
      <MemberAvatar member={member} className="h-10 w-10" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink-100">{member?.name ?? '알 수 없음'}</span>

          {isLive ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              LIVE
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-stage-800 px-2 py-0.5 text-[10px] font-medium text-ink-500">
              <Icon size={11} /> {meta.label}
            </span>
          )}
        </div>

        {/* 방송 제목은 길어서 한 줄로 자르면 대부분 읽을 수 없다. 2줄까지 접어서 보여준다. */}
        <p className="mt-0.5 line-clamp-2 break-words text-sm font-medium leading-snug text-ink-300">
          {notification.title}
        </p>
        {notification.snippet && (
          <p className="mt-0.5 truncate text-xs text-ink-500">{notification.snippet}</p>
        )}

        <div className="mt-1.5 flex items-center justify-between">
          {status === 'live' && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-red-500">
              <Eye size={11} />
              {notification.liveViewers != null
                ? `${notification.liveViewers.toLocaleString('ko-KR')}명 시청 중`
                : '방송 중'}
            </span>
          )}
          {status === 'upcoming' && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-sky-600">
              <Clock size={11} /> {timeUntil(notification.timestamp)}
            </span>
          )}
          {status !== 'live' && status !== 'upcoming' && (
            <span className="text-[11px] text-ink-500">{timeAgo(notification.timestamp)}</span>
          )}

          <ExternalLink size={12} className="text-ink-500 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </motion.a>
  );
}
