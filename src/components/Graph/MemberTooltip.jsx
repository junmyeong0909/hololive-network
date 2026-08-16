import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Users, Music2, ExternalLink } from 'lucide-react';
import MemberAvatar from '../MemberAvatar.jsx';

const MARGIN = 8;

/** 실제 렌더된 크기와 그래프 영역 크기를 재서 밖으로 나가지 않는 좌표를 계산한다. */
function clampPosition(el, x, y) {
  const parent = el.offsetParent;
  const maxW = parent?.clientWidth ?? window.innerWidth;
  const maxH = parent?.clientHeight ?? window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  // 오른쪽에 자리가 없으면 노드 왼쪽으로 뒤집는다
  let left = x + w + MARGIN > maxW ? x - w - 48 : x;
  left = Math.max(MARGIN, Math.min(left, maxW - w - MARGIN));
  const top = Math.max(MARGIN, Math.min(y, maxH - h - MARGIN));
  return { left, top };
}

/**
 * 노드를 따라 계속 움직여야 하는 툴팁이라 위치를 React state로 두면 안 된다.
 * 시뮬레이션이 도는 동안이나 줌·팬 중에는 매 프레임 좌표가 바뀌는데, 그때마다
 * setState로 리렌더하면(예전 구현) 프레임마다 리액트 재조정 + framer-motion
 * 재계산이 겹쳐 눈에 띄게 렉이 생긴다.
 *
 * 그래서 위치는 ref로 노출한 reposition()이 DOM style을 직접 건드리는 방식으로
 * 바꿨다. React state(부모의 tooltip 상태)는 "열림/내용"이 바뀔 때만 관여한다.
 */
const MemberTooltip = forwardRef(function MemberTooltip({ member, connections, x, y, onClose }, ref) {
  const elRef = useRef(null);

  useImperativeHandle(
    ref,
    () => ({
      reposition(nx, ny) {
        const el = elRef.current;
        if (!el) return;
        const { left, top } = clampPosition(el, nx, ny);
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
      },
    }),
    []
  );

  // 새로 열리거나(member 변경) 내용 크기가 바뀔 때(connections 개수)만 초기 배치
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const { left, top } = clampPosition(el, x, y);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.id, connections?.length]);

  if (!member) return null;

  return (
    <motion.div
      ref={elRef}
      initial={{ opacity: 0, scale: 0.95, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      style={{ left: x, top: y }}
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
          <Users size={12} /> 자주 함께하는 멤버 ({connections.length})
        </p>
        <div className="space-y-1.5">
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
          {connections.length === 0 && (
            <p className="py-2 text-center text-xs leading-relaxed text-ink-500">
              함께한 기록이 아직 충분하지 않아요.
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
});

export default MemberTooltip;
