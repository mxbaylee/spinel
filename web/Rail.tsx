import './profile.css';
import { ThemeMenu } from '../src/ui/redesign/ThemeMenu.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import type { NavigationGuard } from './navigation.ts';
import { ConnectionStatus } from './ConnectionStatus.tsx';
import type { CatalogConnectionDetails } from './ConnectionStatus.tsx';
import type { ConnectionState } from './connectionState.ts';

/**
 * The gem rail: a column beside the workspace, and a top bar on phones. It must
 * be the direct `<header>` child of `.workspace`, which theme.css styles.
 * Links ask the navigation guard first, so unsaved changes are not lost.
 */
export function Rail({
  user,
  navigation,
  onSignOut,
  connection,
  catalog,
  documentOpen,
  compact = false,
}: {
  /** Signed-out visitors see only the brand link. */
  user: { isAdmin: boolean; name?: string; icon?: string; color?: string } | null;
  navigation: Pick<NavigationGuard, 'allow'>;
  onSignOut: () => void;
  connection?: ConnectionState;
  catalog?: CatalogConnectionDetails | null;
  documentOpen?: boolean;
  compact?: boolean;
}) {
  return (
    <header
      className={compact ? 'rail-compact' : undefined}
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
      <div className="rail-brand">
        <a className="brand rail-button" href="/">
          <span className="wiggle">
            <GemLogo />
          </span>
          <span className="rail-label">Your docs</span>
        </a>
        {user && connection && (
          <ConnectionStatus state={connection} catalog={catalog} documentOpen={documentOpen} />
        )}
      </div>
      {user && (
        <>
          <nav aria-label="Workspace">
            <a className="rail-button" href={user.isAdmin ? '/admin' : '/'}>
              <span aria-hidden="true">▦</span>
              <span className="rail-label">{user.isAdmin ? 'Admin' : 'Dashboard'}</span>
            </a>
          </nav>
          <div className="rail-account">
            <ThemeMenu />
            <a
              className="rail-button"
              href="/profile"
              aria-label="Your profile"
              title={user.name ? `${user.name} — Your profile` : 'Your profile'}
            >
              <span
                className="profile-rail-avatar"
                style={{
                  background: `var(--fill-${user.color ?? 'primary-strong'}-bg)`,
                  color: `var(--fill-${user.color ?? 'primary-strong'}-fg)`,
                }}
              >
                <ProfileIcon icon={user.icon ?? 'lucide:user-round'} />
              </span>
              <span className="rail-label">{user.name ?? 'Your profile'}</span>
            </a>
            {!compact && (
              <button className="rail-button" onClick={onSignOut}>
                <span aria-hidden="true">↪</span>
                <span className="rail-label">Sign out</span>
              </button>
            )}
          </div>
        </>
      )}
    </header>
  );
}
