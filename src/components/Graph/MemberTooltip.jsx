import { motion } from 'framer-motion';
import { X, Users, Music2 } from 'lucide-react';

export default function MemberTooltip({ member, connections, x, y, onClose }) {
  if (!member) return null;

  // 화면 밖으로 나가지 않도록 위치 보정
  const style = {
    left: Math.max(12, Math.min(x, window.innerWidth - 300)),
    top: Math.max(12, y),
  };

  return (
    <motion.div
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

      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-display font-semibold text-slate-900"
          style={{ backgroundColor: member.color }}
        >
          {member.initials}
        </div>
        <div>
          <p className="text-sm font-semibold text-ink-100">{member.name}</p>
          <p className="text-[11px] text-ink-500">{member.unit}</p>
        </div>
      </div>

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
