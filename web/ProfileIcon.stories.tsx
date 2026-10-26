import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';

// Regression samples for Lucide 1.59.0. Retain saved names beside their current
// names so the real renderer remains visible in every theme and viewport.
const changedIcons = [
  'barrel',
  'broccoli',
  'card-sim',
  'chess-queen',
  'cookie',
  'folder-bookmark',
  'lectern',
  'mail-pen',
  'map-pinned',
  'nut-off',
  'nut',
  'pen-tool',
  'salad',
  'save-off',
  'soup',
  'tool-case',
  'wifi-cog',
] as const;

const savedAndCurrentNames = [
  'album',
  'square-bookmark',
  'book-marked',
  'book-bookmark',
  'building-2',
  'building-complex',
  'music',
  'eighth-notes',
  'music-2',
  'eighth-note',
  'music-3',
  'half-note',
  'music-4',
  'sixteenth-notes',
] as const;

const additionalIcons = [
  'armenian-dram',
  'bangladeshi-taka',
  'belarusian-ruble',
  'briefcase-plus',
  'building-complex-plus',
  'calendar-chevrons-left',
  'calendar-chevrons-right',
  'certificate',
  'circle-fading-play',
  'clef-alto',
  'clef-bass',
  'clef-treble',
  'cpu-ai',
  'cupcake',
  'door-closed-cog',
  'door-closed-package',
  'faucet',
  'folder-user',
  'folder-users',
  'globe-code',
  'graph-star',
  'groceries',
  'guitar-electric',
  'handle-bottom-right',
  'hiking-stick',
  'hourglass-cog',
  'house-cog',
  'houses',
  'iv-bag',
  'kazakh-tenge',
  'lambda',
  'layout-arrow-down',
  'layout-arrow-right',
  'layout-grid-circles',
  'lens',
  'letters',
  'line-dot-bottom-vertical',
  'line-dot-left-horizontal',
  'line-dot-top-vertical',
  'mail-dot',
  'message-circle-text',
  'messages-circle',
  'monitor-pc',
  'mouth',
  'mouth-off',
  'nepali-rupee',
  'notebook-dot',
  'park',
  'perfume-bottle',
  'phone-log',
  'plant-pot',
  'printer-3d',
  'rotate-cw-clock',
  'rugby-ball',
  'scratch-blocks',
  'screw',
  'server-nas',
  'shield-house',
  'square-dashed-plus',
  'square-dashed-x',
  'square-dashed-x-corner',
  'square-sparkles',
  'text-align-justify-center',
  'text-align-justify-end',
  'text-align-justify-start',
  'tube-lotion',
  'user-round-star',
  'users-collaboration',
  'users-round-collaboration',
  'wifi-lock',
  'wind-arrow-up',
] as const;

function Samples({ label, names }: { label: string; names: readonly string[] }) {
  return (
    <section aria-label={label}>
      <h2>{label}</h2>
      <ul
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          margin: '0 0 24px',
          padding: 0,
          listStyle: 'none',
        }}
      >
        {names.map((name) => (
          <li
            key={name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              padding: 12,
              border: '1px solid var(--sp-border)',
              borderRadius: 8,
              background: 'var(--sp-panel)',
            }}
          >
            <span style={{ display: 'inline-flex', flexShrink: 0 }}>
              <ProfileIcon icon={`lucide:${name}`} size={20} />
            </span>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 14 }}>{name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const meta = {
  id: 'account-profile-icons',
  title: 'Current production/Account/Profile icons',
  component: ProfileIcon,
  args: { icon: 'lucide:user-round' },
} satisfies Meta<typeof ProfileIcon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CatalogCompatibility: Story = {
  render: () => (
    <>
      <h1>Profile icons</h1>
      <p>Icons used in profiles and shared documents, shown at their usual 20-pixel size.</p>
      <Samples label="Existing icon shapes" names={changedIcons} />
      <Samples label="Saved names and current names" names={savedAndCurrentNames} />
      <Samples label="Additional profile icons" names={additionalIcons} />
    </>
  ),
};
