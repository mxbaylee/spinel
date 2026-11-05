import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { rendererOutput } from '../../src/build/rendererChunks.ts';

test('actual renderer grouping leaves shared startup code outside the lazy renderer and preserves initialization', async () => {
  const require = createRequire(import.meta.url);
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href);
  const directory = await mkdtemp(join(tmpdir(), 'spn090-renderer-'));
  try {
    const renderer = join(directory, 'node_modules/@univerjs/engine-render');
    await mkdir(renderer, { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'shared.ts'), 'export const events = ["shared"];');
    await writeFile(
      join(renderer, 'dictionary.ts'),
      `import { events } from ${JSON.stringify(join(directory, 'shared.ts'))}; events.push('dictionary'); export const word = 'layout';`,
    );
    await writeFile(
      join(renderer, 'index.ts'),
      `import { events } from ${JSON.stringify(join(directory, 'shared.ts'))}; events.push('renderer'); export const read = async () => (await import('./dictionary.ts')).word;`,
    );
    await writeFile(
      join(directory, 'editor.ts'),
      `import { read } from ${JSON.stringify(join(renderer, 'index.ts'))}; export const open = read;`,
    );
    await writeFile(
      join(directory, 'main.ts'),
      'import { events } from "./shared.ts"; globalThis.__spn090RendererFixture = { events, open: async () => (await import("./editor.ts")).open() };',
    );
    for (const repaired of [false, true]) {
      const outputDirectory = join(directory, repaired ? 'repaired' : 'baseline');
      const bundler = await rolldown({
        input: join(directory, 'main.ts'),
        preserveEntrySignatures: false,
      });
      let output;
      try {
        ({ output } = await bundler.write({
          ...rendererOutput,
          dir: outputDirectory,
          format: 'es',
          strictExecutionOrder: repaired,
          codeSplitting: {
            groups: rendererOutput.codeSplitting.groups.map((group) =>
              group.name === 'univer-renderer'
                ? { ...group, includeDependenciesRecursively: !repaired }
                : group,
            ),
          },
        }));
      } finally {
        await bundler.close();
      }
      const chunks = output.filter((row: any) => row.type === 'chunk');
      const main = chunks.find((row: any) => row.isEntry);
      assert.ok(main);
      const closure = new Set<string>();
      const visit = (file: string) => {
        if (closure.has(file)) return;
        closure.add(file);
        const chunk = chunks.find((row: any) => row.fileName === file);
        assert.ok(chunk, 'every imported chunk emitted');
        chunk.imports.forEach(visit);
      };
      visit(main.fileName);
      const rendererChunks = chunks.filter((row: any) =>
        Object.keys(row.modules).some((id) => id.includes('/@univerjs/engine-render/')),
      );
      assert.ok(rendererChunks.length > 0);
      assert.equal(
        rendererChunks.some((row: any) => closure.has(row.fileName)),
        !repaired,
      );
      assert.ok(
        rendererChunks.some((row: any) =>
          Object.keys(row.modules).some((id) => id.endsWith('/dictionary.ts')),
        ),
      );
      if (repaired) {
        await import(pathToFileURL(join(outputDirectory, main.fileName)).href);
        const observed = (globalThis as any).__spn090RendererFixture;
        assert.deepEqual(observed.events, ['shared']);
        assert.equal(await observed.open(), 'layout');
        assert.deepEqual(observed.events, ['shared', 'renderer', 'dictionary']);
      }
    }
  } finally {
    delete (globalThis as any).__spn090RendererFixture;
    await rm(directory, { recursive: true, force: true });
  }
});
