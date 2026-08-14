import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Users, Music2, ExternalLink } from 'lucide-react';
import MemberAvatar from '../MemberAvatar.jsx';

const MARGIN = 8;

export default function MemberTooltip({ member, connections, x, y, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 실제 렌더된 크기와 그래프 영역 크기를 재서 밖으로 나가지 않게 보정한다.
  // window 기준으로 계산하면 사이드바 폭만큼 어긋나고 아래쪽도 넘친다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const parent = el.offsetParent;
    const maxW = parent?.clientWidth ?? window.innerWidth;
    const maxH = parent?.clientHeight ?? window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    // 오른쪽에 자리가 없으면 노드 왼쪽으로 뒤집는다
    let left = x + w + MARGIN > maxW ? x - w - 48 : x;
    left = Math.max(MARGIN, Math.min(left, maxW - w - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, maxH - h - MARGIN));

    // 같은 값이면 새 객체를 만들지 않는다 (무한 리렌더 방지)
    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [x, y, member?.id, connections?.length]);

  if (!member) return null;

  const style = { left: pos.left, top: pos.top };

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      style={style}
      className="pointer-events-auto absolute z-30 w-[280px] rounded-2xl border border-stage-border bg-stage-800/95 p-4 shadow-2xl backdrop-blur"
    >
      <button onClick={onClose} className="absolute right-3 top-3 text-ink-500 hover:text-ink-100">
        <X size={14} />
      </button>

      {/* 헤더 전체가 유튜브 채널로 가는 링크. 채널 ID가 없으면 링크 없이 표시만 한다. */}
      {member.youtubeChannelId ? (
        <a
          href={`https://www.youtube.com/channel/${member.youtubeChannelId}`}
          target="_blank"
          rel="noreferrer"
          title={`${member.name} 채널 열기`}
          className="group -m-1.5 flex items-center gap-2.5 rounded-xl p-1.5 pr-7 transition-colors hover:bg-stage-700/70"
        >
          <MemberAvatar member={member} className="h-9 w-9" />
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-sm font-semibold text-ink-100">
              {member.name}
              <ExternalLink
                size={11}
                className="shrink-0 text-ink-500 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </p>
            <p className="truncate text-[11px] text-ink-500">{member.unit}</p>
          </div>
        </a>
      ) : (
        <div className="flex items-center gap-2.5">
          <MemberAvatar member={member} className="h-9 w-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink-100">{member.name}</p>
            <p className="truncate text-[11px] text-ink-500">{member.unit}</p>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-stage-border pt-3">
        <p className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">
          <Users size={12} /> 교류 멤버 ({connections.length})
        </p>
        <div className="max-h-48 space-y-1.5 overflow-y-auto feed-scroll pr-1">
          {connections.map((c) => (
            <div key={c.member.id} className="flex items-center justify-between rounded-lg bg-stage-700/60 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.member.color }} />
                <span className="text-xs font-medium text-ink-100">{c.member.name}</span>
              </div>
              <span className="flex items-center gap-1 text-[10px] text-ink-500">
                합방 {c.collabCount} · <Music2 size={10} /> {c.coverCount}
              </span>
            </div>
          ))}
          {connections.length === 0 && <p className="py-2 text-center text-xs text-ink-500">아직 교류 기록이 없어요.</p>}
        </div>
      </div>
    </motion.div>
  );
}
