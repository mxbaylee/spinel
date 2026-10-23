import { useState } from 'react';
import './profile.css';
import './fileRail.css';
import { Modal } from '../src/ui/redesign/Controls.tsx';
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
  files,
}: {
  /** Signed-out visitors see only the brand link. */
  user: { isAdmin: boolean; name?: string; icon?: string; color?: string } | null;
  navigation: Pick<NavigationGuard, 'allow'>;
  onSignOut: () => void;
  connection?: ConnectionState;
  catalog?: CatalogConnectionDetails | null;
  documentOpen?: boolean;
  compact?: boolean;
  files?: { shared: boolean; open: (shared: boolean) => void } | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const places = () => (
    <nav className="file-rail-places" aria-label="File places">
      {[false, true].map((shared) => (
        <button
          key={String(shared)}
          className="rail-button"
          aria-label={shared ? 'Shared with me' : 'My files'}
          aria-current={files?.shared === shared ? 'page' : undefined}
          onClick={() => {
            files?.open(shared);
            setDrawer(false);
          }}
        >
          <ProfileIcon icon={shared ? 'lucide:users-round' : 'lucide:files'} size={22} />
          <span className="rail-label">{shared ? 'Shared with me' : 'My files'}</span>
        </button>
      ))}
    </nav>
  );
  const account = () =>
    user && (
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
    );
  return (
    <header
      className={
        files
          ? `file-rail${collapsed ? ' file-rail-collapsed' : ''}`
          : compact
            ? 'rail-compact'
            : undefined
      }
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
      {files && user && !user.isAdmin ? (
        <>
          <button
            className="rail-button file-rail-toggle"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ProfileIcon
              icon={collapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'}
              size={22}
            />
            <span className="rail-label">
              {collapsed ? 'Expand navigation' : 'Collapse navigation'}
            </span>
          </button>
          <div className="file-rail-desktop">
            {places()}
            {account()}
          </div>
          <button
            className="file-rail-browse"
            onClick={() => setDrawer(true)}
            aria-expanded={drawer}
          >
            Browse files
          </button>
          <Modal title="Browse files" icon="folder" open={drawer} onOpenChange={setDrawer}>
            <div className="file-rail-drawer">
              {places()}
              {account()}
            </div>
          </Modal>
        </>
      ) : (
        user && (
          <>
            <nav aria-label="Workspace">
              <a className="rail-button" href={user.isAdmin ? '/admin' : '/'}>
                <span aria-hidden="true">▦</span>
                <span className="rail-label">{user.isAdmin ? 'Admin' : 'Dashboard'}</span>
              </a>
            </nav>
            {account()}
          </>
        )
      )}
    </header>
  );
}
