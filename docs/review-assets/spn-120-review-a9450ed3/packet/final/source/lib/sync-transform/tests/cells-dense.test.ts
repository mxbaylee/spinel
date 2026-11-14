import { test } from 'vitest';
import { cellEdit, commandEdit, denseBook } from './generate-cells.ts';
import { convergesOver } from './simulate.ts';

// Seed and mutation counts bound these intent/growth sweeps; CI bounds the job.
// Keep them in their own file so CI can run them apart from other cell coverage.
const unclocked = 0;

// Short runs meet the seeded type/format combinations before edits replace them;
// long runs exercise repeated rebases and accumulated history. Native commands
// also contribute their range-shift and metadata mutations.
test(
  'dense cell edits converge within budget, as the edits meant',
  () => {
    const document = { workbook: denseBook() };
    for (const [generate, seeds, mutations] of [
      [cellEdit, 1000, 40],
      [cellEdit, 300, 300],
      [commandEdit, 300, 40],
      [commandEdit, 20, 300],
    ] as const) {
      // 5× holds for this generator's stream only; the hard bound is the 50× 'growth' cap.
      convergesOver(generate, { seeds, mutations, document, budget: 5, intent: true });
    }
  },
  unclocked,
);

// Other dimensions exercise different range geometries, including those that
// once failed on 3×3 (seed 377), 5×4 (seed 162) and 2×5 (seeds 314 and 355).
test.each([
  [3, 3, 400],
  [2, 3, 250],
  [5, 4, 200],
  [2, 5, 400],
])(
  'dense command edits on a %i×%i sheet converge, as the edits meant',
  (rows, cols, seeds) => {
    const document = { workbook: denseBook(rows, cols) };
    convergesOver(commandEdit, {
      seeds,
      mutations: 40,
      document,
      budget: 5,
      intent: true,
    });
  },
  unclocked,
);
