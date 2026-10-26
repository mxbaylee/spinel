import { expect, test } from 'vitest';
import { pdfWorkerBudget, pdfMemoryExceeded } from './capacity.ts';
import type { PdfMemory } from './capacity.ts';
const MiB = 1024 * 1024;
const memory = (overrides: Partial<PdfMemory> = {}): PdfMemory => ({
  parentRssBytes: 170 * MiB,
  availableBytes: 1024 * MiB,
  containerLimitBytes: 512 * MiB,
  containerUsedBytes: 190 * MiB,
  ...overrides,
});

test('a smaller 512 MiB container lowers the worker allowance while preserving headroom', () => {
  expect(pdfWorkerBudget(memory())).toBe(290 * MiB);
  expect(() => pdfWorkerBudget(memory({ containerUsedBytes: 310 * MiB }))).toThrow(
    'This file exceeds the PDF export limit',
  );
});

test('the 1 GiB app budget admits measured startup usage but refuses other live container pressure', () => {
  // The confirmed app baseline needs more room than the original 512 MiB cap.
  const deployed = memory({
    parentRssBytes: 450 * MiB,
    containerLimitBytes: 1024 * MiB,
    containerUsedBytes: 430 * MiB,
  });
  expect(pdfWorkerBudget(deployed)).toBe(562 * MiB);
  expect(() => pdfWorkerBudget({ ...deployed, containerLimitBytes: 512 * MiB })).toThrow();
  expect(() => pdfWorkerBudget({ ...deployed, containerUsedBytes: 816 * MiB })).toThrow();
  expect(
    pdfMemoryExceeded({ ...deployed, containerUsedBytes: 993 * MiB }, 200 * MiB, 562 * MiB),
  ).toBe(true);
});

test('shared cgroup pressure stops native work before the configured container ceiling', () => {
  expect(pdfMemoryExceeded(memory({ containerUsedBytes: 481 * MiB }), 100 * MiB, 290 * MiB)).toBe(
    true,
  );
  expect(pdfMemoryExceeded(memory({ containerUsedBytes: 400 * MiB }), 291 * MiB, 290 * MiB)).toBe(
    true,
  );
  expect(pdfMemoryExceeded(memory({ containerUsedBytes: 400 * MiB }), 200 * MiB, 290 * MiB)).toBe(
    false,
  );
});

test('host pressure and parent growth independently reject or stop work', () => {
  expect(() => pdfWorkerBudget(memory({ availableBytes: 250 * MiB }))).toThrow();
  expect(pdfMemoryExceeded(memory({ availableBytes: 100 * MiB }), 100 * MiB, 290 * MiB)).toBe(true);
  expect(pdfMemoryExceeded(memory({ parentRssBytes: 1500 * MiB }), 100 * MiB, 290 * MiB)).toBe(
    true,
  );
});
