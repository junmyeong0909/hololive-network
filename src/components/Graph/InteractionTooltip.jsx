import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, ExternalLink, Music2, Radio } from 'lucide-react';
import MemberAvatar from '../MemberAvatar.jsx';

const MARGIN = 8;

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return m && d ? `${y}.${m}.${d}` : iso;
}

/**
 * 교류선을 클릭했을 때 뜨는 팝업. 두 멤버가 함께한 합방 목록을 최신순으로 보여준다.
 * 위치 보정 로직은 MemberTooltip과 같은 방식(실제 렌더 크기 + 그래프 영역 기준).
 */
export default function InteractionTooltip({ pair, events, x, y, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const parent = el.offsetParent;
    const maxW = parent?.clientWidth ?? window.innerWidth;
    const maxH = parent?.clientHeight ?? window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    let left = x + w + MARGIN > maxW ? x - w - 24 : x;
    left = Math.max(MARGIN, Math.min(left, maxW - w - MARGIN));
    const top = Math.max(MARGIN, Math.min(y, maxH - h - MARGIN));

    setPos((prev) => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, [x, y, pair?.a?.id, pair?.b?.id, events?.length]);

  if (!pair) return null;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      style={{ left: pos.left, top: pos.top }}
      className="pointer-events-auto absolute z-30 w-[300px] rounded-2xl border border-stage-border bg-stage-800/95 p-4 shadow-2xl backdrop-blur"
    >
      <button onClick={onClose} className="absolute right-3 top-3 text-ink-500 hover:text-ink-100">
        <X size={14} />
      </button>

      <div className="flex items-center gap-2 pr-6">
        <MemberAvatar member={pair.a} className="h-7 w-7" textClassName="text-[10px]" />
        <MemberAvatar member={pair.b} className="h-7 w-7" textClassName="text-[10px]" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink-100">
            {pair.a.name} <span className="text-ink-500">×</span> {pair.b.name}
          </p>
          <p className="text-[11px] text-ink-500">함께한 활동 {events.length}건</p>
        </div>
      </div>

      <div className="feed-scroll mt-3 max-h-56 space-y-1.5 overflow-y-auto border-t border-stage-border pt-3 pr-1">
        {events.map((ev) => {
          const Icon = ev.type === 'cover' ? Music2 : Radio;
          return (
            <a
              key={ev.id}
              href={ev.url}
              target="_blank"
              rel="noreferrer"
              className="group block rounded-lg bg-stage-700/60 px-2.5 py-2 transition-colors hover:bg-stage-600/70"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[10px] font-medium text-ink-500">
                  <Icon size={10} /> {ev.type === 'cover' ? '커버' : '합방'}
                  {ev.participants.length > 2 && ` · ${ev.participants.length}인`}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-500">
                  {formatDate(ev.lastDate)}
                  <ExternalLink size={9} className="opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-ink-300">
                {ev.title || '(제목 없음)'}
              </p>
            </a>
          );
        })}
        {events.length === 0 && (
          <p className="py-2 text-center text-xs text-ink-500">기록을 불러올 수 없어요.</p>
        )}
      </div>
    </motion.div>
  );
}
