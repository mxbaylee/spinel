import { useEffect, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { getDocsEmptySnapshot, type ICustomRange } from '@univerjs/core';
import { formulaBody, type FormulaDefinition, type FormulaState } from '@spinel/doc-formulas';
import { FormulaReadout } from './DocFormulas.tsx';

function NativeFormulaDocument({
  unavailable = false,
  thirtyRows = false,
  styledScalar = false,
}: {
  unavailable?: boolean;
  thirtyRows?: boolean;
  styledScalar?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [states, setStates] = useState<FormulaState[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    let close: (() => void) | undefined;
    const scalar: FormulaDefinition = {
      version: 1,
      expression: '=1234.56',
      references: [],
      format: 'currency',
    };
    const table: FormulaDefinition = thirtyRows
      ? {
          version: 1,
          expression: '=Budget.Summary.A1:C30',
          references: [
            { start: 1, end: 22, itemId: 'storybook-budget', sheetId: 'summary', range: 'A1:C30' },
          ],
        }
      : { version: 1, expression: '={1,2;3,4}', references: [] };
    const rows = thirtyRows
      ? Array.from({ length: 30 }, (_, row) => [`Item ${row + 1}`, row + 101, row + 201])
      : [
          [1, 2],
          [3, 4],
        ];
    const ranges: ICustomRange[] = [];
    let text = 'The current total is ';
    for (const [id, definition, suffix] of [
      ['total', scalar, ' for this report.\r\r'],
      ['array', table, '\r\rThe table and value are native document objects.\r\n'],
    ] as const) {
      const body = formulaBody(id, definition);
      ranges.push({
        ...body.customRanges![0]!,
        startIndex: text.length,
        endIndex: text.length + definition.expression.length - 1,
      });
      text += definition.expression + suffix;
    }
    const snapshot = getDocsEmptySnapshot('storybook-native-formulas');
    snapshot.body = {
      dataStream: text,
      customRanges: ranges,
      ...(styledScalar
        ? {
            textRuns: [
              {
                st: ranges[0]!.startIndex,
                ed: ranges[0]!.endIndex + 1,
                ts: { bl: 1, it: 1, fs: 18 },
              },
            ],
          }
        : {}),
      paragraphs: Array.from(text.matchAll(/\r/g), (match) => ({
        startIndex: match.index!,
        paragraphId: `paragraph-${match.index}`,
      })),
    };
    void import('./snapshotViewer.ts')
      .then(({ openSnapshotViewer }) => {
        if (abort.signal.aborted) throw new DOMException('Closed', 'AbortError');
        return openSnapshotViewer({
          container: container.current!,
          kind: 'doc',
          snapshot,
          signal: abort.signal,
          evaluateFormula: async (definition) =>
            unavailable
              ? { ok: false, reason: 'private-source' }
              : definition.expression === scalar.expression
                ? { ok: true, kind: 'scalar', value: 1234.56 }
                : {
                    ok: true,
                    kind: 'table',
                    rows,
                  },
          onFormulaChange: (values) => {
            if (!abort.signal.aborted) setStates([...values]);
          },
        });
      })
      .then((dispose) => {
        if (abort.signal.aborted) dispose();
        else close = dispose;
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(String(cause));
      });
    return () => {
      abort.abort();
      queueMicrotask(() => close?.());
    };
  }, [unavailable, thirtyRows, styledScalar]);
  return (
    <section aria-label="Native formula document">
      <p>
        Read-only example using the same native renderer as the editor. Values are local fixtures.
      </p>
      {error && <p role="alert">{error}</p>}
      <FormulaReadout states={states} />
      <div className="univer-container" ref={container} style={{ height: '44rem' }} />
    </section>
  );
}
const meta = {
  id: 'docs-native-formulas',
  title: 'Current production/Docs/Native formulas',
  component: NativeFormulaDocument,
} satisfies Meta<typeof NativeFormulaDocument>;
export default meta;
type Story = StoryObj<typeof meta>;
export const InlineAndTable: Story = {};
export const Private: Story = { args: { unavailable: true } };
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = { globals: { viewport: { value: 'phone', isRotated: false } } };

export const ThirtyRows: Story = { args: { thirtyRows: true } };
export const StyledScalar: Story = { args: { styledScalar: true } };
