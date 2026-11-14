import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { LocaleType } from '@univerjs/core';
import { fixtureFonts } from './font-fixtures.ts';
import { retainPdf, runNativeJobs } from './native-test-support.ts';
import { docInput, retainDocPdf, runDocJobs, textDoc } from './doc-native-test-support.ts';

test('renders from an isolated standalone source package with only its declared runtime dependencies', async () => {
  const source = fileURLToPath(new URL('.', import.meta.url));
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
    name: string;
    exports: string;
    dependencies: Record<string, string>;
  };
  expect(manifest.name).toBe('@spinel/print');
  const require = createRequire(import.meta.url);
  const isolated = await mkdtemp(join(tmpdir(), 'spinel-print-standalone-'));
  try {
    const target = join(isolated, 'print');
    // A source workspace can be moved independently; Node 24 intentionally does
    // not type-strip published dependencies inside node_modules. No app source,
    // fixture, test helper, source font or dev dependency enters this copy.
    await cp(source, target, {
      recursive: true,
      filter: (path) => {
        const name = basename(path);
        return !name.includes('test') && !name.includes('fixture') && name !== 'node_modules';
      },
    });
    for (const dependency of Object.keys(manifest.dependencies)) {
      expect(dependency).not.toMatch(/^@spinel\//);
      expect(dependency).not.toMatch(/^@univerjs-pro\//);
      let directory = dirname(require.resolve(dependency));
      while (true) {
        try {
          const candidate = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
          if (candidate.name === dependency) break;
        } catch {
          /* The resolved entry may sit below its package root. */
        }
        const parent = dirname(directory);
        if (parent === directory) throw new Error(`Cannot locate dependency ${dependency}`);
        directory = parent;
      }
      const link = join(isolated, 'node_modules', dependency);
      await mkdir(dirname(link), { recursive: true });
      await symlink(directory, link, 'dir');
    }
    const fonts = await fixtureFonts();
    const [result] = await runNativeJobs(
      [
        {
          input: {
            fonts: [fonts[0]],
            defaultFamily: fonts[0].family,
            images: [],
            snapshot: {
              id: 'standalone',
              name: 'Standalone synthetic input',
              appVersion: '1.1.0',
              locale: LocaleType.EN_US,
              styles: {},
              sheetOrder: ['sheet'],
              sheets: {
                sheet: {
                  id: 'sheet',
                  rowCount: 1,
                  columnCount: 1,
                  defaultColumnWidth: 250,
                  defaultRowHeight: 40,
                  cellData: { 0: { 0: { v: 'Independent package output' } } },
                },
              },
            },
          },
        },
      ],
      pathToFileURL(join(target, manifest.exports)).href,
    );
    expect(result).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const pages = await retainPdf('standalone-package', result.bytes!);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain('Independent package output');
    const [document] = await runDocJobs(
      [{ input: await docInput(textDoc(['Independent Doc package output'])) }],
      pathToFileURL(join(target, manifest.exports)).href,
    );
    expect(document).toMatchObject({ ok: true, pages: 1, restored: true, remainingFonts: 0 });
    const docPages = await retainDocPdf('standalone-doc-package', document.bytes!);
    expect(docPages[0].text).toContain('Independent Doc package output');
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}, 90_000);
