import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import type { IDocumentData, ITable, IParagraph } from '@univerjs/core';
import type { DocPrintInput } from './index.ts';
import type { DocNativeJob, DocNativeResult } from './doc-native-fixture.ts';
import { fixtureFonts } from './font-fixtures.ts';
import { retainPdf } from './native-test-support.ts';

export const docEvidenceDirectory = resolve('output/pdf/spn-102');
export const retainDocPdf = (name: string, bytes: Uint8Array) =>
  retainPdf(name, bytes, docEvidenceDirectory);

export async function runDocJobs(
  jobs: DocNativeJob[],
  packageEntry?: string,
): Promise<DocNativeResult[]> {
  const worker = fork(new URL('./doc-native-fixture.ts', import.meta.url), [], {
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
    if (process.env.PRINT_FIXTURE_DEBUG) process.stderr.write(data);
    if (stderr.length < 8192) stderr += data.toString();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((accept, reject) => {
      let results: DocNativeResult[] | undefined;
      worker.once('message', (message) => {
        results = message as DocNativeResult[];
      });
      worker.once('error', reject);
      // The process may exit before its final PDF batch has drained from IPC.
      worker.once('close', (code) => {
        if (code === 0 && results) accept(results);
        else reject(new Error(`Doc fixture exited (${code}): ${stderr}`));
      });
      timer = setTimeout(() => {
        worker.kill('SIGKILL');
        reject(new Error('Doc fixture exceeded its process deadline.'));
      }, 60_000);
      worker.send(jobs);
    });
  } finally {
    clearTimeout(timer);
    if (worker.exitCode === null) worker.kill('SIGKILL');
  }
}

export function textDoc(
  lines: string[],
  style: IDocumentData['documentStyle'] = {},
): IDocumentData {
  let start = 0;
  return {
    id: 'private-account-sentinel',
    title: 'PRIVATE DOC TITLE',
    body: {
      dataStream: `${lines.join('\r')}\r\n`,
      paragraphs: lines.map((line, index) => {
        start += line.length;
        return { startIndex: start++, paragraphId: `p${index}` };
      }),
    },
    documentStyle: {
      pageSize: { width: 600, height: 700 },
      marginLeft: 48,
      marginRight: 48,
      marginTop: 48,
      marginBottom: 48,
      textStyle: { ff: 'Atkinson Hyperlegible', fs: 14 },
      ...style,
    },
  };
}

export async function docInput(snapshot = textDoc(['Complete document'])): Promise<DocPrintInput> {
  return {
    snapshot,
    fonts: await fixtureFonts(),
    defaultFamily: 'Atkinson Hyperlegible',
    fallbackFamilies: ['Noto Sans Symbols 2'],
    images: [],
  };
}

/** Authored public native table; stream offsets are derived from every complete cell. */
export function tableDoc(rows: string[][], prefix: string[] = [], rowHeight = 36): IDocumentData {
  const snapshot = textDoc(prefix);
  let stream = prefix.length ? `${prefix.join('\r')}\r` : '';
  const startIndex = stream.length;
  const paragraphs: IParagraph[] = prefix.length ? [...snapshot.body!.paragraphs!] : [];
  stream += '\x1a';
  for (const [rowIndex, row] of rows.entries()) {
    stream += '\x1b';
    for (const [column, value] of row.entries()) {
      stream += `\x1c${value}`;
      paragraphs.push({ startIndex: stream.length, paragraphId: `r${rowIndex}c${column}` });
      stream += '\r\n\x1d';
    }
    stream += '\x0e';
  }
  stream += '\x0f';
  const endIndex = stream.length;
  stream += 'TABLE-END-SENTINEL';
  paragraphs.push({ startIndex: stream.length, paragraphId: 'table-tail' });
  stream += '\r\n';
  const columns = rows[0].length;
  const width = 480 / columns;
  const border = {
    color: { rgb: '#775276' },
    width: { v: 1, u: 3 as const },
    dashStyle: 1 as const,
  };
  const table: ITable = {
    tableId: 'native-table',
    align: 0,
    indent: { v: 0 },
    textWrap: 0,
    position: { positionH: { relativeFrom: 3 }, positionV: { relativeFrom: 1 } },
    dist: { distT: 0, distB: 0, distL: 0, distR: 0 },
    size: { type: 1, width: { v: 480, u: 3 } },
    layout: 1,
    tableColumns: Array.from({ length: columns }, () => ({
      size: { type: 1, width: { v: width, u: 3 } },
    })),
    tableRows: rows.map((row) => ({
      trHeight: { val: { v: rowHeight, u: 3 }, hRule: 1 },
      tableCells: row.map(() => ({
        size: { type: 1, width: { v: width, u: 3 } },
        margin: {
          start: { v: 5, u: 3 },
          end: { v: 5, u: 3 },
          top: { v: 5, u: 3 },
          bottom: { v: 5, u: 3 },
        },
        borderTop: border,
        borderBottom: border,
        borderLeft: border,
        borderRight: border,
      })),
    })),
  };
  snapshot.body = {
    dataStream: stream,
    paragraphs,
    tables: [{ startIndex, endIndex, tableId: table.tableId }],
  };
  snapshot.tableSource = { [table.tableId]: table };
  return snapshot;
}
