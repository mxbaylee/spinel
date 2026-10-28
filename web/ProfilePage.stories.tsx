import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { ProfilePage } from './ProfilePage.tsx';
import { Rail } from './Rail.tsx';
import { guestLinkExamples } from './guestLinksStoryData.ts';
const profile = { name: 'Alex Baylee', icon: 'lucide:flower', color: 'info-strong' };
const api = {
  'GET /api/auth/profile': profile,
  'POST /api/auth/profile': profile,
  'GET /api/auth/connections': { connections: [] },
  'GET /api/auth/tokens': { tokens: [] },
  'GET /api/guest-links': { items: guestLinkExamples },
};
function Preview({
  section = 'profile',
  admin = false,
  offline = false,
}: {
  section?: string;
  admin?: boolean;
  offline?: boolean;
}) {
  const [user, setUser] = useState({ id: 'profile-story', ...profile, isAdmin: admin });
  useEffect(() => {
    const previous = location.href;
    history.replaceState(null, '', '/profile#' + section);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return () => history.replaceState(null, '', previous);
  }, [section]);
  return (
    <div className="workspace profile-workspace">
      <Rail
        user={user}
        compact
        navigation={{ allow: () => false }}
        onSignOut={fn()}
        connection={offline ? 'offline' : 'online'}
      />
      <div className="workspace-body">
        <main>
          <ProfilePage
            user={user}
            offline={offline}
            onSaved={(saved) => setUser({ ...user, ...saved })}
            onSignOut={fn()}
            passkeys={
              <section>
                <h2>Your passkeys</h2>
                <p>Sign in securely on your devices.</p>
                <ul className="profile-passkeys">
                  <li>MacBook</li>
                </ul>
                <button className="primary">Add a passkey</button>
              </section>
            }
          />
        </main>
      </div>
    </div>
  );
}
const meta = {
  id: 'account-profile-page',
  title: 'Current production/Account/Your profile',
  component: Preview,
  parameters: { shell: 'none' },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Profile: Story = { parameters: { api } };
export const Passkeys: Story = { args: { section: 'passkeys' }, parameters: { api } };
export const ThisDevice: Story = { args: { section: 'device' }, parameters: { api } };
export const Connections: Story = { args: { section: 'connections' }, parameters: { api } };
export const GuestLinks: Story = { args: { section: 'links' }, parameters: { api } };
export const GuestLinksOffline: Story = {
  args: { offline: true, section: 'links' },
  parameters: { api },
};
export const GuestLinksOperator: Story = {
  args: { admin: true, section: 'links' },
  parameters: { api },
};
export const Operator: Story = { args: { admin: true }, parameters: { api } };
export const Offline: Story = { args: { offline: true, section: 'device' } };
export const Phone: Story = {
  parameters: { api },
  globals: { viewport: { value: 'phone', isRotated: false } },
};
