import type { Meta, StoryObj } from '@storybook/react-vite';
import { EntityIcon } from './EntityIcon.tsx';
import { entityLabels, entityIconSvg } from './entityIconGeometry.ts';
import './entityIconStories.css';

const kinds = ['doc', 'sheet', 'space'] as const;
const meta = {
  title: 'Identity/Entity icons',
  component: EntityIcon,
  args: { kind: 'doc', size: 32, label: 'Doc', monochrome: false },
  argTypes: { kind: { control: 'select', options: kinds }, size: { control: 'number' } },
} satisfies Meta<typeof EntityIcon>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Standalone: Story = {};
export const Lineup: Story = {
  render: () => (
    <section className="entity-gallery" aria-label="Entity icon lineup">
      <h1>One gem family</h1>
      <p>Docs, Sheets and Spaces. Same size, their own mark.</p>
      <div className="entity-gallery-grid">
        {kinds.map((kind) => (
          <article key={kind}>
            <EntityIcon kind={kind} size={128} />
            <h2>{entityLabels[kind]}</h2>
            <div className="entity-gallery-sizes">
              {[16, 24, 32].map((size) => (
                <div key={size}>
                  <EntityIcon kind={kind} size={size} />
                  <small>{size}px</small>
                </div>
              ))}
            </div>
            <p>
              <EntityIcon kind={kind} monochrome size={32} /> Monochrome
            </p>
            <a
              href={`data:image/svg+xml,${encodeURIComponent(entityIconSvg(kind))}`}
              download={`${kind}.svg`}
            >
              Download {entityLabels[kind]} SVG
            </a>
          </article>
        ))}
      </div>
    </section>
  ),
};
export const InContext: Story = {
  render: () => (
    <section className="entity-gallery" aria-label="Entity icon placement examples">
      <h1>Create and browse</h1>
      <p>Artwork examples. Space creation and navigation are previews of a future feature.</p>
      <div className="entity-example-actions">
        {kinds.map((kind) => (
          <button key={kind} type="button" disabled={kind === 'space'}>
            <EntityIcon kind={kind} size={32} /> Create {entityLabels[kind]}
            {kind === 'space' ? ' (coming later)' : ''}
          </button>
        ))}
      </div>
      <h2>Files and sidebar</h2>
      <ul className="entity-example-files">
        {kinds.map((kind, i) => (
          <li key={kind}>
            <EntityIcon kind={kind} />{' '}
            <span>{['Autumn recipes', 'Household budget', 'Our household'][i]}</span>
            <small>
              {entityLabels[kind]}
              {kind === 'space' ? ' · Preview' : ''}
            </small>
          </li>
        ))}
      </ul>
    </section>
  ),
};
export const Monochrome: Story = { args: { monochrome: true } };
export const Phone: Story = {
  ...InContext,
  globals: { viewport: { value: 'phone', isRotated: false } },
};
