import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EditorFrame, useEditorChrome } from './EditorFrame.tsx';
import { EditorTools } from './EditorTools.tsx';
import { SaveStatus } from './SaveStatus.tsx';

function Fixture() {
  const chrome = useEditorChrome();
  return (
    <section className="sheet-editor" aria-label="Editor geometry fixture">
      <SaveStatus
        target={chrome?.saveTarget ?? null}
        state={{ dirty: false, failed: false, message: 'All changes saved.' }}
        onRetry={fn()}
      />
      <EditorTools
        id="fixture"
        name="Quarterly planning"
        people={[
          {
            id: 'a',
            name: 'Alexandria Nakamura-Fernandez — a long collaborator name',
            color: '#7950f2',
            selection: 'Planning!B2',
            jump: fn(),
          },
          { id: 'b', name: 'Sam Rivera', color: '#087f5b' },
        ]}
        saved
        print={async () => {}}
      />
      <div className="univer-container" style={{ background: 'var(--sp-panel)', padding: 24 }}>
        Geometry fixture. Native selection and rendering are checked in Playwright.
      </div>
    </section>
  );
}
const meta = {
  id: 'editor-frame',
  title: 'Current production/Editor/Frame',
  component: EditorFrame,
  args: {
    name: 'Quarterly planning',
    connection: 'online',
    access: 'Can edit',
    onBack: fn(),
    children: <Fixture />,
  },
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    localStorage.removeItem('spinel-theatre');
  },
} satisfies Meta<typeof EditorFrame>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = {
  globals: { viewport: { value: 'phone', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Save details: Saved' }).getBoundingClientRect().width).toBe(44);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
export const Guest: Story = { args: { guest: true, onBack: undefined, access: 'View only' } };
export const Reconnecting: Story = { args: { connection: 'reconnecting' } };
export const Rename: Story = { args: { onRename: fn(async () => {}) } };
export const PeopleAndTheatre: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement),
      body = within(document.body);
    await userEvent.click(canvas.getByRole('button', { name: 'People in this document' }));
    const people = await body.findByRole('dialog', { name: 'People in this document' });
    await expect(
      within(people).getByText('Alexandria Nakamura-Fernandez — a long collaborator name'),
    ).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(within(people).getByRole('button', { name: 'Close dialog' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Enter theatre mode' }));
    const exit = canvas.getByRole('button', { name: 'Exit theatre mode' });
    await expect(exit).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Save details: Saved' }).getBoundingClientRect().width,
    ).toBe(44);
    await userEvent.click(canvas.getByRole('button', { name: 'Save details: Saved' }));
    await userEvent.keyboard('{Escape}');
    await expect(exit).toBeVisible();
    exit.focus();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByRole('button', { name: 'Enter theatre mode' })).toBeVisible();
  },
};
