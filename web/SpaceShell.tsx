import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { GemLogo, replayGemWiggle } from '../src/ui/GemLogo.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { getPreference, setPreference, watchTheme } from '../src/ui/theme.ts';
import type { ThemePreference } from '../src/ui/theme.ts';
import { ActionMenu, Button, SegmentedChoice } from '../src/ui/redesign/Controls.tsx';
import { ConnectionStatus } from './ConnectionStatus.tsx';
import type { ConnectionState } from './connectionState.ts';
import './space.css';

export interface SpaceUser {
  id: string;
  name: string;
  icon?: string;
  color?: string;
}

const compactQuery = '(max-width: 900px)';
const compactSnapshot = () => window.matchMedia(compactQuery).matches;
function watchCompact(changed: () => void) {
  const query = window.matchMedia(compactQuery);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}

export function SpaceShell({
  user,
  connection,
  documentOpen,
  onExit,
  onProfile,
  onSignOut,
  navigation,
  navigationButton,
  children,
}: {
  user: SpaceUser;
  connection: ConnectionState;
  documentOpen: boolean;
  onExit(): void;
  onProfile(): void;
  onSignOut(): void;
  navigation?: (close: () => void) => ReactNode;
  navigationButton?: RefObject<HTMLButtonElement>;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [themeError, setThemeError] = useState('');
  const localPages = useRef<HTMLButtonElement>(null);
  const pages = navigationButton ?? localPages;
  const preference = useSyncExternalStore(watchTheme, getPreference);
  const compact = useSyncExternalStore(watchCompact, compactSnapshot);
  const hasNavigation = Boolean(navigation);
  useEffect(() => {
    if (!hasNavigation) setDrawer(false);
  }, [hasNavigation]);
  function collapse() {
    setExpanded(false);
    requestAnimationFrame(() => pages.current?.focus());
  }
  return (
    <div className={`sp-ui space-shell ${navigation && expanded ? 'space-with-tree' : ''}`}>
      <header className="space-site-header">
        <button
          className="space-brand"
          type="button"
          aria-label="Spinel home"
          onClick={(event) => {
            replayGemWiggle(event.currentTarget);
            onExit();
          }}
        >
          <span className="wiggle">
            <GemLogo />
          </span>
        </button>
        <ConnectionStatus state={connection} documentOpen={documentOpen} />
        <button
          className="space-site-button"
          type="button"
          aria-label="My files"
          title="My files"
          onClick={onExit}
        >
          <ProfileIcon icon="lucide:layout-grid" />
        </button>
        <div className="space-account-controls">
          <SegmentedChoice
            label="Appearance on this device"
            value={preference}
            onChange={(next) =>
              setThemeError(
                setPreference(next as ThemePreference)
                  ? ''
                  : 'Theme changed for this visit. Your preference could not be saved.',
              )
            }
            options={[
              {
                value: 'system',
                label: 'Follow system',
                icon: <ProfileIcon icon="lucide:monitor" />,
              },
              { value: 'light', label: 'Light', icon: <ProfileIcon icon="lucide:sun" /> },
              { value: 'dark', label: 'Dark', icon: <ProfileIcon icon="lucide:moon" /> },
            ]}
          />
          <ActionMenu
            label={`${user.name} — Profile`}
            actions={[
              { label: 'Profile settings', onClick: onProfile },
              { label: 'Sign out', onClick: onSignOut },
            ]}
          >
            <span
              className="space-avatar"
              style={{
                background: `var(--fill-${user.color ?? 'primary-strong'}-bg)`,
                color: `var(--fill-${user.color ?? 'primary-strong'}-fg)`,
              }}
            >
              <ProfileIcon icon={user.icon ?? 'lucide:user-round'} />
            </span>
          </ActionMenu>
        </div>
        {themeError && (
          <div className="space-theme-error" role="alert">
            <p>{themeError}</p>
            <Button onClick={() => setThemeError('')}>Dismiss</Button>
          </div>
        )}
      </header>
      {navigation && expanded && (
        <aside className="space-desktop-tree" aria-label="Space contents">
          <div className="space-tree-collapse">
            <Button className="sp-quiet" aria-label="Collapse navigation" onClick={collapse}>
              <ProfileIcon icon="lucide:chevron-left" />
            </Button>
          </div>
          {navigation(() => {})}
        </aside>
      )}
      <main className="space-main">
        {navigation && (
          <div className="space-pages-control">
            <button
              ref={pages}
              className="sp-control sp-quiet"
              type="button"
              aria-label="Open Space contents"
              aria-expanded={drawer || (expanded && !compact)}
              onClick={() => {
                if (compact) setDrawer(true);
                else setExpanded(true);
              }}
            >
              <ProfileIcon icon="lucide:panel-left" /> Pages
            </button>
          </div>
        )}
        {children}
      </main>
      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Backdrop className="sp-backdrop" />
          <Dialog.Popup className="sp-ui space-pages-dialog" finalFocus={pages}>
            <div className="space-pages-heading">
              <Dialog.Title>Space contents</Dialog.Title>
              <Dialog.Close className="sp-control sp-quiet" aria-label="Close Space contents">
                <ProfileIcon icon="lucide:x" />
              </Dialog.Close>
            </div>
            {navigation?.(() => setDrawer(false))}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
