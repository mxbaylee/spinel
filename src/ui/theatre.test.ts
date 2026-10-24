import { describe, expect, it } from 'vitest';
import { shouldExitTheatre } from '../../web/theatre.ts';

describe('theatre Escape ownership', () => {
  const idle = {
    key: 'Escape',
    prevented: false,
    composing: false,
    editing: false,
    interactive: false,
    overlay: false,
  };
  it('exits only an idle document, without introducing another keyboard shortcut', () => {
    expect(shouldExitTheatre(idle)).toBe(true);
    expect(shouldExitTheatre({ ...idle, key: 'f' })).toBe(false);
  });
  it.each(['prevented', 'composing', 'editing', 'interactive', 'overlay'] as const)(
    'leaves %s cancellation to its current owner',
    (owner) => {
      expect(shouldExitTheatre({ ...idle, [owner]: true })).toBe(false);
    },
  );
});
