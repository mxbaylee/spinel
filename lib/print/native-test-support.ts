/** Shared synthetic evidence helpers; no production host or source preparation. */
import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { NativeJob, NativeResult } from './native-fixture.ts';

export const evidenceDirectory = resolve('output/pdf/spn-101-candidate');

export async function runNativeJobs(
  jobs: NativeJob[],
  packageEntry?: string,
): Promise<NativeResult[]> {
  const worker = fork(new URL('./native-fixture.ts', import.meta.url), [], {
    env: {
      ...process.env,
      DISABLE_SYSTEM_FONTS_LOAD: '1',
      ...(packageEntry ? { PRINT_PACKAGE_ENTRY: packageEntry } : {}),
    },
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  worker.stderr?.on('data', (data: Buffer) => {
    if (stderr.length < 8_192) stderr += data.toString();
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<NativeResult[]>((accept, reject) => {
      let result: NativeResult[] | undefined;
      worker.once('message', (message) => {
        result = message as NativeResult[];
      });
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code === 0 && result) accept(result);
        else reject(new Error(`Native fixture exited (${code}): ${stderr}`));
      });
      timeout = setTimeout(() => {
        worker.kill('SIGKILL');
        reject(new Error('Native fixture exceeded its process deadline.'));
      }, 60_000);
      worker.send(jobs);
    });
  } finally {
    clearTimeout(timeout);
    if (worker.exitCode === null) worker.kill('SIGKILL');
  }
}

/** Reopen and retain every page, including pages preceding a later failed assertion. */
export async function retainPdf(name: string, bytes: Uint8Array) {
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(resolve(evidenceDirectory, `${name}.pdf`), bytes);
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const pages = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      await writeFile(
        resolve(evidenceDirectory, `${name}-${index}.png`),
        await canvas.encode('png'),
      );
      const items = (await page.getTextContent()).items.flatMap((item) =>
        'str' in item ? [item] : [],
      );
      pages.push({
        view: page.view,
        text: items.map((item) => item.str).join(' '),
        items,
        width: canvas.width,
        height: canvas.height,
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}
