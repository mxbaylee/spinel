export const reviewViewports = ['desktop', 'tablet', 'mobile'] as const;
export type ReviewViewport = (typeof reviewViewports)[number];

// Keep the unsharded review order and every existing theme/size combination.
const variants = [
  ['light', 1280, 'light'],
  ['dark', 1280, 'dark'],
  ['light', 390, 'phone'],
  ['dark', 390, 'phone-dark'],
  ['light', 768, 'tablet'],
] as const;
const widths: Record<ReviewViewport, readonly number[]> = {
  desktop: [1280],
  // The intermediate mouse-driven layout remains covered as well as touch tablet.
  tablet: [768, 613],
  mobile: [390],
};

export function selectStorybookReview(
  args: readonly string[],
  entries: Record<string, { type: string }>,
) {
  let viewport: ReviewViewport | 'all' = 'all';
  let viewportSpecified = false;
  const storyIds: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--viewport') {
      if (viewportSpecified) throw new Error('Specify --viewport only once.');
      const value = args[++i];
      if (value !== 'all' && !reviewViewports.some((candidate) => candidate === value)) {
        throw new Error('--viewport requires desktop, tablet, mobile, or all.');
      }
      viewport = value as ReviewViewport | 'all';
      viewportSpecified = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown review option: ${arg}`);
    } else {
      storyIds.push(arg);
    }
  }
  const requested = storyIds.length
    ? storyIds
    : Object.keys(entries).filter((id) => entries[id].type === 'story');
  for (const id of requested) {
    if (entries[id]?.type !== 'story') throw new Error(`Unknown story: ${id}`);
  }
  const includesWidth = (width: number) => viewport === 'all' || widths[viewport].includes(width);
  return {
    viewport,
    requested,
    variants: variants.filter(([, width]) => includesWidth(width)),
    nativeEditorKinds:
      viewport === 'all' || viewport === 'desktop' ? (['sheet', 'doc'] as const) : [],
    dashboardViewports: (
      [
        [1280, false],
        [768, true],
        [613, false],
        [390, true],
      ] as const
    ).filter(([width]) => includesWidth(width)),
    spaceWidths: [1280, 768, 390].filter(includesWidth),
    journeyWidths: [1280, 390].filter(includesWidth),
  };
}
