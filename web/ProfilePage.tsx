import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Profile } from '../src/profile/profile.ts';
import { ProfileSettings } from './ProfileSettings.tsx';
import { ThemeSettings } from '../src/ui/ThemeSettings.tsx';
import { AssistantConnections } from './AssistantConnections.tsx';
import { AccessTokens } from './AccessTokens.tsx';
import { rememberedFileHref } from './fileNavigation.ts';
import './profile.css';

const sections = [
  ['profile', 'Profile'],
  ['passkeys', 'Passkeys'],
  ['device', 'This device'],
  ['connections', 'Connected assistants'],
] as const;
type Section = (typeof sections)[number][0];

export function ProfilePage({
  user,
  offline = false,
  onSaved,
  onSignOut,
  passkeys,
}: {
  user: { id: string; name: string; isAdmin: boolean };
  offline?: boolean;
  onSaved: (profile: Profile) => void;
  onSignOut: () => void;
  passkeys: ReactNode;
}) {
  const readSection = (): Section => {
    const hash = location.hash.slice(1);
    return sections.some(([id]) => id === hash) && !(user.isAdmin && hash === 'connections')
      ? (hash as Section)
      : offline
        ? 'device'
        : 'profile';
  };
  const [section, setSection] = useState(readSection);
  useEffect(() => {
    const update = () => setSection(readSection());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  });
  return (
    <div className="profile-page">
      <header className="profile-page-heading">
        <div>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h1>Your profile</h1>
        </div>
        <div className="profile-page-actions">
          <a href={user.isAdmin ? '/admin' : rememberedFileHref(user.id)}>
            {user.isAdmin ? 'Back to administration' : 'Back to files'}
          </a>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <div className="profile-layout">
        <nav aria-label="Profile sections">
          {sections
            .filter(([id]) => !user.isAdmin || id !== 'connections')
            .map(([id, label]) => (
              <a key={id} href={`#${id}`} aria-current={section === id ? 'page' : undefined}>
                {label}
              </a>
            ))}
        </nav>
        <div className="profile-content">
          <div hidden={section !== 'profile'}>
            {offline ? (
              <p>Your saved profile needs a connection.</p>
            ) : (
              <ProfileSettings onSaved={onSaved} isAdmin={user.isAdmin} />
            )}
          </div>
          <div hidden={section !== 'passkeys'}>
            {offline ? <p>Passkeys need a connection.</p> : passkeys}
          </div>
          <div hidden={section !== 'device'}>
            <ThemeSettings />
          </div>
          {!user.isAdmin && (
            <div hidden={section !== 'connections'}>
              {offline ? (
                <p>Connected assistants and access tokens need a connection.</p>
              ) : (
                <>
                  <AssistantConnections />
                  <details>
                    <summary>Advanced: personal access tokens</summary>
                    <AccessTokens />
                  </details>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
