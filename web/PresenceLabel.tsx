import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
export function PresenceLabel({
  name,
  icon = 'lucide:user-round',
  color,
  foreground = '#ffffff',
}: {
  name: string;
  icon?: string;
  color: string;
  foreground?: string;
}) {
  // Inline styling is intentional: Univer popups render outside the app shell.
  return (
    <span
      data-presence-label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 6,
        background: color,
        color: foreground,
        font: '12px system-ui',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        maxWidth: 'min(220px, calc(100vw - 32px))',
        overflow: 'hidden',
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>
        <ProfileIcon icon={icon} />
      </span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </span>
  );
}
