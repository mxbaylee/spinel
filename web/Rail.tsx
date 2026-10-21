import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import type { NavigationGuard } from './navigation.ts';

/**
 * The gem rail: a column beside the workspace, and a top bar on phones. It must
 * be the direct `<header>` child of `.workspace`, which theme.css styles.
 * Links ask the navigation guard first, so unsaved changes are not lost.
 */
export function Rail({
  user,
  navigation,
  onSignOut,
}: {
  /** Signed-out visitors see only the brand link. */
  user: { isAdmin: boolean; name?: string; icon?: string; color?: string } | null;
  navigation: Pick<NavigationGuard, 'allow'>;
  onSignOut: () => void;
}) {
  return (
    <header
      onClick={(event) => {
        if (
          (event.target as Element).closest('a') &&
          !event.metaKey &&
          !event.ctrlKey &&
          !navigation.allow()
        )
          event.preventDefault();
      }}
    >
      <a className="brand rail-button" href="/">
        <span className="wiggle">
          <GemLogo />
        </span>
        <span className="rail-label">Your docs</span>
      </a>
      {user && (
        <nav aria-label="Workspace">
          <a className="rail-button" href={user.isAdmin ? '/admin' : '/'}>
            <span aria-hidden="true">▦</span>
            <span className="rail-label">{user.isAdmin ? 'Admin' : 'Dashboard'}</span>
          </a>
          <a className="rail-button" href="/settings">
            <span
              className="profile-rail-avatar"
              style={{
                background: `var(--fill-${user.color ?? 'primary-strong'}-bg)`,
                color: `var(--fill-${user.color ?? 'primary-strong'}-fg)`,
              }}
            >
              <ProfileIcon icon={user.icon ?? 'lucide:user-round'} />
            </span>
            <span className="rail-label">Settings</span>
          </a>
          <button className="rail-button" onClick={onSignOut}>
            <span aria-hidden="true">↪</span>
            <span className="rail-label">Sign out</span>
          </button>
        </nav>
      )}
    </header>
  );
}
