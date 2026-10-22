import type { Meta, StoryObj } from '@storybook/react-vite';
import { faviconSvg } from './favicon.ts';
import { palettes } from './palette.ts';
import type { ThemeMode } from './palette.ts';

function FaviconSamples({ mode }: { mode: ThemeMode | 'auto' }) {
  const palette = palettes[mode === 'dark' ? 'dark' : 'light'];
  return (
    <section
      style={{
        padding: 24,
        background: mode === 'auto' ? 'var(--sp-bg)' : palette['sp-bg'],
        color: mode === 'auto' ? 'var(--sp-text)' : palette['sp-text'],
      }}
    >
      <h1>Spinel browser icon</h1>
      <p>
        {mode === 'auto'
          ? 'Follows the browser color scheme.'
          : `${mode === 'dark' ? 'Dark' : 'Light'} color scheme.`}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 24 }}>
        {[16, 32, 64].map((size) => (
          <figure key={size} style={{ margin: 0 }}>
            <img
              src={`data:image/svg+xml,${encodeURIComponent(faviconSvg(mode))}`}
              width={size}
              height={size}
              alt={`Spinel favicon at ${size} pixels`}
            />
            <figcaption>{size}px</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const meta = {
  title: 'Identity/Favicon',
  component: FaviconSamples,
  parameters: { shell: 'none', layout: 'fullscreen' },
} satisfies Meta<typeof FaviconSamples>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Light: Story = { args: { mode: 'light' } };
export const Dark: Story = { args: { mode: 'dark' } };
export const Automatic: Story = { args: { mode: 'auto' } };
