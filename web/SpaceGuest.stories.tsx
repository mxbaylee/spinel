import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { failure, pending } from '../.storybook/api.ts';
import type { SpaceNode, SpaceTreeData } from '../src/shared/spaces.ts';
import { Space } from './Space.tsx';
import type { SpaceEditorProps } from './Space.tsx';

const root = '88888888-8888-4888-8888-888888888888';
const id = (value: number) => value.toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111';
const timestamp = Date.UTC(2026, 9, 22, 12);
const node = (
  value: number,
  name: string,
  kind: SpaceNode['kind'],
  parentId = root,
  position = 0,
): SpaceNode => ({
  id: id(value),
  spaceId: root,
  parentId,
  position,
  name,
  kind,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const nodes = [
  node(1, 'Welcome', 'doc'),
  node(2, 'Budget', 'sheet', id(1)),
  node(3, 'Research', 'folder', root, 1),
  node(4, 'Field notes', 'doc', id(3)),
];
const tree = (access: 'viewer' | 'editor', items = nodes): SpaceTreeData => ({
  space: {
    id: root,
    name: 'Project Atlas',
    kind: 'space',
    parentId: null,
    spaceId: null,
    position: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  access,
  items,
});
const api = (access: 'viewer' | 'editor', items = nodes) => ({
  [`GET /api/guest-spaces/${root}`]: tree(access, items),
});

function GuestRoute({ href, children }: { href: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const previous = { href: location.href, state: history.state };
    history.replaceState({}, '', href);
    setReady(true);
    return () => history.replaceState(previous.state, '', previous.href);
  }, [href]);
  return ready ? children : null;
}

/** Only the editor body is a fixture; the guest controller and shell are real. */
function GuestEditor({ item, access, onDirty }: SpaceEditorProps) {
  const [value, setValue] = useState('Shared project notes belong to this Space.');
  return (
    <section aria-label="Guest editor body fixture" style={{ padding: 24 }}>
      <p className="sp-muted">
        {item.kind === 'doc' ? 'Doc' : 'Sheet'} body fixture · native editing is verified in the
        browser suite.
      </p>
      <label>
        Shared page content fixture
        <textarea
          value={value}
          readOnly={access === 'viewer'}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 220,
            marginTop: 12,
            padding: 16,
            font: 'inherit',
            color: 'var(--sp-text)',
            background: 'var(--sp-panel)',
            border: '1px solid var(--sp-border)',
            borderRadius: 8,
          }}
          onChange={(event) => {
            setValue(event.target.value);
            onDirty(true);
          }}
        />
      </label>
      <p role="status">{access === 'viewer' ? 'View only.' : 'Can edit this shared page.'}</p>
    </section>
  );
}

const meta = {
  id: 'space-guest',
  title: 'Current production/Spaces/Guest Space',
  component: Space,
  parameters: {
    shell: 'none',
    docs: {
      description: {
        component:
          'The actual guest Space controller and shell, with no account user or profile. Tree responses and the native editor body are fixtures. Real link exchange, native persistence, revocation and privacy are covered by the Space guest browser tests.',
      },
    },
  },
  args: {
    guest: true,
    connection: 'online',
    navigation: { allow: () => true, dirty: fn() },
    onExit: fn(),
    onConnectionState: fn(),
    renderEditor: (props) => <GuestEditor {...props} />,
  },
  render: (args, { parameters }) => (
    <GuestRoute
      key={parameters.guestPath ?? 'page'}
      href={parameters.guestPath ?? `/share/${root}?item=${id(1)}`}
    >
      <Space {...args} />
    </GuestRoute>
  ),
} satisfies Meta<typeof Space>;
export default meta;
type Story = StoryObj<typeof meta>;

async function guestOnly(canvasElement: HTMLElement, title = 'Welcome') {
  const canvas = within(canvasElement);
  await expect(await canvas.findByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(canvas.getByText('Guest', { exact: true })).toBeVisible();
  for (const name of ['My files', 'Spinel home', 'New Space', 'Versions', 'Your profile'])
    await expect(canvas.queryByRole('button', { name })).not.toBeInTheDocument();
  await expect(canvas.queryByRole('link', { name: 'Space Trash' })).not.toBeInTheDocument();
  await expect(
    canvas.queryByRole('button', { name: /^Space actions for/ }),
  ).not.toBeInTheDocument();
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  );
}

export const ViewOnly: Story = {
  // Keep replies on each story: merging a success body with failure()/pending()
  // at the meta level drops their Symbol marker and turns them into successes.
  parameters: { api: api('viewer') },
  play: async ({ canvasElement }) => {
    await guestOnly(canvasElement);
    // The shell heading can appear before the selected editor mounts.
    await expect(
      await within(canvasElement).findByLabelText('Shared page content fixture'),
    ).toHaveAttribute('readonly');
    await expect(
      within(canvasElement).queryByRole('button', { name: 'Add page' }),
    ).not.toBeInTheDocument();
  },
};
export const ViewOnlyDark: Story = { ...ViewOnly, globals: { theme: 'dark' } };
export const ViewOnlyPhone: Story = {
  ...ViewOnly,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
export const CanEdit: Story = {
  parameters: { api: api('editor') },
  play: async ({ canvasElement }) => {
    await guestOnly(canvasElement);
    await expect(
      await within(canvasElement).findByLabelText('Shared page content fixture'),
    ).not.toHaveAttribute('readonly');
    await expect(within(canvasElement).getByText('Can edit', { exact: true })).toBeVisible();
  },
};
export const CanEditDark: Story = { ...CanEdit, globals: { theme: 'dark' } };
export const CanEditPhone: Story = {
  ...CanEdit,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
export const NestedPage: Story = {
  parameters: { guestPath: `/share/${root}?item=${id(4)}`, api: api('viewer') },
  play: ({ canvasElement }) => guestOnly(canvasElement, 'Field notes'),
};
export const PhoneContents: Story = {
  parameters: { api: api('editor') },
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    await guestOnly(canvasElement);
    const canvas = within(canvasElement);
    let contents = canvas;
    if (window.matchMedia('(max-width: 900px)').matches) {
      await userEvent.click(canvas.getByRole('button', { name: 'Open Space contents' }));
      const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog', {
        name: 'Space contents',
      });
      await expect(dialog).toBeVisible();
      contents = within(dialog);
    } else {
      // The capture matrix also runs this story at desktop width, where Pages
      // expands inline. Exercise its real collapse/reopen control in that case.
      await userEvent.click(canvas.getByRole('button', { name: 'Collapse navigation' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Open Space contents' }));
      const navigation = await canvas.findByRole('navigation', { name: 'Pages' });
      await expect(navigation).toBeVisible();
      contents = within(navigation);
    }
    await expect(contents.getByRole('button', { name: 'Add page' })).toBeEnabled();
    await expect(contents.queryByRole('link', { name: 'Space Trash' })).not.toBeInTheDocument();
    const links = contents.getAllByRole('link');
    for (const link of links)
      await expect(link.getAttribute('href')).toMatch(new RegExp(`^/share/${root}\\?item=`));
  },
};
export const Empty: Story = {
  parameters: { guestPath: `/share/${root}`, api: api('viewer', []) },
  play: async ({ canvasElement }) => {
    await guestOnly(canvasElement, 'Project Atlas');
    await expect(
      await within(canvasElement).findByRole('heading', { name: 'This Space is empty' }),
    ).toBeVisible();
  },
};
export const Loading: Story = {
  parameters: { api: { [`GET /api/guest-spaces/${root}`]: pending() } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = await canvas.findByText('Loading Space…', { exact: true });
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toBeVisible();
    await expect(
      canvas.queryByRole('region', { name: 'Guest editor body fixture' }),
    ).not.toBeInTheDocument();
  },
};
export const Unavailable: Story = {
  parameters: {
    api: { [`GET /api/guest-spaces/${root}`]: failure('This Space is not available.', 404) },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'This Space is not available.',
    );
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'My files' })).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('region', { name: 'Guest editor body fixture' }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText('Space · Project Atlas', { exact: true }),
    ).not.toBeInTheDocument();
  },
};
export const RecoveryDeepLinkRefused: Story = {
  parameters: { guestPath: `/share/${root}?trash=1` },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('heading', { name: 'This Space link is not available.' }),
    ).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'My files' })).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole('region', { name: 'Deleted Space contents' }),
    ).not.toBeInTheDocument();
  },
};
