import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { AppearanceDialog, CoverArt, ItemIcon } from '../../../web/Appearance.tsx';
import { emptyAppearance, gemNames } from '../../shared/appearance.ts';
import type { GemName, ItemAppearance } from '../../shared/appearance.ts';
import { GemPairs } from './AppearanceReview.tsx';
import { Button } from './Controls.tsx';
import { spaceAccentPalettes } from '../palette.ts';

function Playground({
  kind,
  gem,
  open,
  failSave,
}: {
  kind: 'doc' | 'sheet' | 'folder' | 'space';
  gem: GemName;
  open: boolean;
  failSave: boolean;
}) {
  const [value, setValue] = useState<ItemAppearance>({
    ...emptyAppearance(),
    cover: kind === 'doc' || kind === 'sheet' ? { source: 'gem', gem } : null,
  });
  const [dialog, setDialog] = useState(open);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const target = { id: 'storybook-fixture', name: 'Field notes', kind };
  return (
    <div
      className="sp-ui"
      style={{ minHeight: '100dvh', background: 'var(--sp-bg)', color: 'var(--sp-text)' }}
    >
      {value.cover && (
        <div className="appearance-banner">
          <CoverArt cover={value.cover} path="/storybook-fixture" assets={assets} />
        </div>
      )}
      <div style={{ padding: 24 }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ItemIcon {...target} appearance={value} size={32} />
          {target.name}
        </h1>
        <p>
          Production appearance controls with local save fixtures. Unsplash requires the running
          application and a configured provider.
        </p>
        <Button onClick={() => setDialog(true)}>Appearance</Button>
        <p>
          Use Controls to change item type or starting gem. Use the theme toolbar to review both
          modes.
        </p>
      </div>
      {dialog && (
        <AppearanceDialog
          assets={assets}
          target={target}
          value={value}
          path="/storybook-fixture"
          close={() => setDialog(false)}
          save={async (patch) => {
            if (failSave) throw new Error('Save failed. Your previous cover is unchanged.');
            const cover = patch.cover as
              { source: string; images?: Record<string, string | { data: string }> } | undefined;
            if (cover?.source === 'upload' && cover.images) {
              const nextAssets: Record<string, string> = {};
              const images = Object.fromEntries(
                Object.entries(cover.images).map(([name, image]) => {
                  if (typeof image === 'string') return [name, image];
                  const hash = `fixture-${name}`;
                  nextAssets[hash] = `data:image/webp;base64,${image.data}`;
                  return [name, hash];
                }),
              );
              setAssets((current) => ({ ...current, ...nextAssets }));
              patch = { ...patch, cover: { ...cover, images } };
            }
            setValue(
              (current) =>
                ({ ...current, ...patch, revision: current.revision + 1 }) as ItemAppearance,
            );
          }}
        />
      )}
    </div>
  );
}
const meta = {
  id: 'redesign-appearance',
  title: 'Current production/Appearance',
  component: Playground,
  parameters: { shell: 'none', layout: 'fullscreen' },
  args: { kind: 'doc', gem: 'spinel', open: false, failSave: false },
  argTypes: {
    kind: { control: 'select', options: ['doc', 'sheet', 'folder', 'space'] },
    gem: { control: 'select', options: gemNames },
  },
  render: (args) => <Playground key={JSON.stringify(args)} {...args} />,
} satisfies Meta<typeof Playground>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PlaygroundStory: Story = {
  name: 'Playground',
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    if (!args.open) await userEvent.click(body.getByRole('button', { name: 'Appearance' }));
    await expect(body.getByRole('button', { name: 'Reset icon' })).toBeDisabled();
    await userEvent.click(body.getByRole('button', { name: 'Choose icon or emoji' }));
    await userEvent.type(body.getByRole('textbox', { name: 'Search icons and emojis' }), 'flower');
    await expect(body.getByRole('button', { name: 'Flower' })).toBeVisible();
    await userEvent.click(body.getByRole('button', { name: 'Sunflower emoji' }));
    await expect(
      canvasElement.ownerDocument.querySelector('.identity-choice-current'),
    ).toHaveTextContent('🌻');
    await userEvent.click(body.getByRole('button', { name: 'Reset icon' }));
    await userEvent.click(body.getByRole('button', { name: 'Choose icon or emoji' }));
    await userEvent.type(body.getByRole('textbox', { name: 'Search icons and emojis' }), 'book');
    await userEvent.click(body.getByRole('button', { name: 'Book Open' }));
    const colors = within(body.getByRole('group', { name: 'Icon color' }));
    await userEvent.click(colors.getByRole('button', { name: 'Info, strong' }));
    await expect(colors.getByRole('button', { name: 'Info, strong' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(body.getByRole('button', { name: 'Save appearance' }));
    if (args.failSave) {
      await expect(body.getByRole('alert')).toHaveTextContent('Save failed');
      return;
    }
    await userEvent.click(body.getByRole('button', { name: 'Appearance' }));
    await expect(body.getByRole('button', { name: 'Info, strong' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    if (args.kind === 'folder' || args.kind === 'space') return;
    await userEvent.click(body.getByRole('button', { name: 'Change cover' }));
    const height = body.getByRole('dialog').getBoundingClientRect().height;
    for (const source of ['Upload', 'Unsplash', 'Gems']) {
      await userEvent.click(body.getByRole('button', { name: source }));
      await expect(
        Math.abs(body.getByRole('dialog').getBoundingClientRect().height - height),
      ).toBeLessThanOrEqual(1);
    }
    await userEvent.click(body.getByRole('button', { name: spaceAccentPalettes[args.gem].label }));
    await userEvent.click(body.getByRole('button', { name: 'Save cover' }));
    if (args.failSave) {
      await expect(body.getByRole('alert')).toHaveTextContent('Save failed');
      return;
    }
    await userEvent.click(body.getByRole('button', { name: 'Cancel' }));
    await expect(
      getComputedStyle(canvasElement.querySelector('.appearance-banner img')!).objectPosition,
    ).toBe('0% 50%');
  },
};
export const GemsLightAndDark: Story = { render: () => <GemPairs /> };
