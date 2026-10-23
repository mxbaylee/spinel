/** Reopen generated PDFs; rendering/visual review is a separate required step. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const output = resolve(process.argv[2] ?? 'output/pdf/spn-097');
const report = [];
for (const name of ['native-doc', 'native-sheet']) {
  const task = getDocument({
    data: new Uint8Array(await readFile(resolve(output, `${name}.pdf`))),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ');
    pages.push({ number: n, view: page.view, text });
    page.cleanup();
  }
  const all = pages.map(({ text }) => text).join('\n');
  const errors = [];
  if (name === 'native-doc') {
    for (let paragraph = 1; paragraph <= 22; paragraph++) {
      const marker = `Paragraph ${String(paragraph).padStart(2, '0')}:`;
      const count = all.split(marker).length - 1;
      if (count !== 1) errors.push(`${marker}: expected once, found ${count}`);
    }
    for (let row = 1; row <= 30; row++) {
      const marker = `ROW-${String(row).padStart(2, '0')}`;
      const count = all.split(marker).length - 1;
      if (count !== 1) errors.push(`${marker}: expected once, found ${count}`);
    }
    if (!pages.at(-1)?.text.includes('EXPLICIT BREAK'))
      errors.push('Explicit break marker missing on final page');
    if (pages.some(({ view }) => view[2] !== 450 || view[3] !== 525))
      errors.push('Stored page dimensions changed');
  } else {
    if (all.includes('HIDDEN-SENTINEL') || /R5 C\d|R\d+ C3\b/.test(all))
      errors.push('Hidden content included');
    for (const marker of ['R2 C1', 'R66 C6', 'NARROW-END']) {
      if (!all.includes(marker)) errors.push(`${marker} missing`);
    }
    for (let row = 2; row <= 66; row++) {
      if (row === 5) continue;
      for (const col of [1, 2, 4, 5, 6]) {
        const marker = `R${row} C${col}`;
        const count = [...all.matchAll(new RegExp(`${marker}(?=\\s|$)`, 'g'))].length;
        if (count !== 1) errors.push(`${marker}: expected once, found ${count}`);
      }
    }
    // This backend rounds the requested fractional A4 points to integer points.
    // Record that limitation, rather than claiming exact fractional geometry.
    if (pages.some(({ view }) => view[2] !== 595 || view[3] !== 842))
      errors.push('A4 page dimensions changed');
  }
  const metadata = await pdf.getMetadata();
  report.push({ name, pages, metadata: metadata.info, errors });
  await task.destroy();
}
await writeFile(resolve(output, 'inspection.json'), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(report.map(({ name, pages, errors }) => ({ name, pages: pages.length, errors }))),
);
if (report.some(({ errors }) => errors.length)) process.exitCode = 1;
