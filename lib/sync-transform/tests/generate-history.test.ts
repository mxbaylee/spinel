import { expect, test } from 'vitest';
import { resetTextMarkers } from './content-intent.ts';
import { seededDoc } from './generate-docs.ts';
import { historyExample, historyFingerprint, historyGenerator } from './generate-history.ts';
import type { GeneratorFamily } from './generate-history.ts';
import { seededWorkbook } from './generate.ts';
import { Replica } from './harness.ts';
import { random } from './random.ts';
import type { Generate } from './simulate.ts';

test.each([
  'structure',
  'cells',
  'commands',
  'cuts',
  'properties',
  'merges',
  'settings',
  'drawings',
  'names',
  'docs',
] as const)(
  '%s emits actual native undo and redo that remote mutation handlers can apply',
  (family) => {
    resetTextMarkers();
    const replica = new Replica({ workbook: seededWorkbook(), doc: seededDoc() });
    try {
      const example = historyExample(family, replica, random(71));
      expect(example).not.toBeNull();
      if (!example) throw new Error(`${family} made no history example`);
      expect(example.undo.length).toBeGreaterThan(0);
      expect(example.redo.length).toBeGreaterThan(0);
      expect(example.undo.every(({ params }) => params.trigger === 'univer.command.undo')).toBe(
        true,
      );
      expect(example.redo.every(({ params }) => params.trigger === 'univer.command.redo')).toBe(
        true,
      );
      replica.apply(example.edit);
      expect(historyFingerprint(replica)).toBe(example.after);
      replica.apply(example.undo);
      expect(historyFingerprint(replica)).toBe(example.undone);
      replica.apply(example.redo);
      expect(historyFingerprint(replica)).toBe(example.after);
    } finally {
      replica.univer.dispose();
    }
  },
);

test('an accepted empty peer revision invalidates cached native undo', () => {
  const families: GeneratorFamily[] = [
    'structure',
    'cells',
    'commands',
    'cuts',
    'properties',
    'merges',
    'settings',
    'drawings',
    'names',
    'docs',
  ];
  const noEdit: Generate = () => null;
  const noEdits = Object.fromEntries(families.map((family) => [family, noEdit])) as Record<
    GeneratorFamily,
    Generate
  >;
  for (const remote of [false, true]) {
    const replica = new Replica({ workbook: seededWorkbook(), doc: seededDoc() });
    try {
      const history = historyGenerator(noEdits);
      const edit = history.generate(replica, () => 0)!;
      expect(edit.length).toBeGreaterThan(0);
      for (const mutation of edit) replica.apply([mutation]);
      if (remote) replica.apply([]);
      const next = history.generate(replica, () => 1);
      if (remote) expect(next).toBeNull();
      else expect(history.describe(next!).action).toBe('undo');
    } finally {
      replica.univer.dispose();
    }
  }
});
