import type { Meta, StoryObj } from '@storybook/react-vite';

// Vite substitutes build-time image data; no server imports reach this module.
declare const __SPINEL_SOCIAL_CARDS__: Record<string, string>;
type Example = 'generic' | 'doc' | 'sheet' | 'emoji' | 'longTitle' | 'longWord';
function SocialCard({ example }: { example: Example }) {
  return (
    <img
      src={__SPINEL_SOCIAL_CARDS__[example]}
      alt={`${example} social preview example`}
      width={1280}
      height={640}
      style={{ display: 'block', width: '100%', maxWidth: 1280, height: 'auto' }}
    />
  );
}
const meta = {
  title: 'Identity/Social cards',
  component: SocialCard,
  argTypes: {
    example: {
      control: 'select',
      options: ['generic', 'doc', 'sheet', 'emoji', 'longTitle', 'longWord'],
    },
  },
} satisfies Meta<typeof SocialCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Generic: Story = { args: { example: 'generic' } };
export const Document: Story = { args: { example: 'doc' } };
export const Spreadsheet: Story = { args: { example: 'sheet' } };
export const Emoji: Story = { args: { example: 'emoji' } };
export const LongTitle: Story = { args: { example: 'longTitle' } };
export const LongWord: Story = { args: { example: 'longWord' } };
