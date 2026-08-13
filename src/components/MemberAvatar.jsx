import { asset } from '../lib/asset.js';

/**
 * 멤버 아바타. 프로필 사진이 있으면 사진을, 없으면 멤버 색상 + 이니셜로 대체한다.
 * 크기는 className으로 지정 (예: "h-10 w-10").
 */
export default function MemberAvatar({ member, className = '', textClassName = 'text-xs' }) {
  const color = member?.color ?? '#8d87ad';

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{
        backgroundColor: member?.profileImg ? '#ffffff' : color,
        boxShadow: `0 0 0 1.5px ${color}`,
      }}
    >
      {member?.profileImg ? (
        <img
          src={asset(member.profileImg)}
          alt={member.name ?? ''}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className={`font-display font-semibold text-slate-900 ${textClassName}`}>
          {member?.initials ?? '?'}
        </span>
      )}
    </span>
  );
}
