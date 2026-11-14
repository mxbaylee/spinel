import { LoadingReview } from './LoadingReview.tsx';
/** Isolated native review editors: no collaboration, authentication or persistence. */
import { useEffect, useRef, useState } from 'react';
import {
  CommandType,
  getDocsEmptySnapshot,
  IPermissionService,
  LocaleType,
  NamedStyleType,
} from '@univerjs/core';
import type { IDocumentData, IWorkbookData, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import { IRenderManagerService } from '@univerjs/engine-render';
import { createUniver, mergeLocales } from '@univerjs/presets';
import { UniverDocsCorePreset } from '@univerjs/preset-docs-core';
import { setDocumentPermissionValue } from '@univerjs/docs';
import { getAllWorkbookPermissionPoint, SheetSkeletonService } from '@univerjs/sheets';
import { UnitAction } from '@univerjs/protocol';
import docsEnglish from '@univerjs/preset-docs-core/locales/en-US';
import sheetsEnglish from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import '@univerjs/preset-sheets-core/lib/index.css';
import { sheetPreset } from '../../../web/sheetPreset.ts';
import { documentReady } from '../../../web/documentReady.ts';
import { editorTheme, installCanvasColors } from '../editorTheme.ts';
import { getTheme, watchTheme } from '../theme.ts';
import './nativeEditors.css';

export type NativeEditorProps = {
  kind: 'doc' | 'sheet';
  title?: string;
  readOnly?: boolean;
  onReady?: (editor: NativeEditorHandle) => void;
  onChange?: () => void;
  getSnapshot?: () => NativeSnapshot | undefined;
  onSnapshot?: (snapshot: NativeSnapshot) => void;
};
export type NativeSnapshot = IWorkbookData | IDocumentData;
export type NativeEditorHandle = {
  api: FUniver;
  getSnapshot: () => NativeSnapshot;
  canEdit: () => boolean;
};

function budgetSnapshot(id: string, title: string): IWorkbookData {
  const rows: [string, number, number][] = [
    ['Groceries', 480, 412.5],
    ['Transport', 120, 84],
    ['Home', 200, 145.5],
    ['Days out', 160, 92],
    ['Books & hobbies', 90, 57.5],
  ];
  const cellData: NonNullable<IWorkbookData['sheets'][string]['cellData']> = {
    0: { 0: { v: 'October budget', s: 'title' } },
    1: { 0: { v: 'A little room for the things we enjoy.', s: 'note' } },
    3: Object.fromEntries(
      ['Category', 'Planned', 'Actual', 'Remaining'].map((v, i) => [i, { v, s: 'heading' }]),
    ),
    10: {
      0: { v: 'Total', s: 'total' },
      1: { f: '=SUM(B5:B9)', s: 'totalMoney' },
      2: { f: '=SUM(C5:C9)', s: 'totalMoney' },
      3: { f: '=B11-C11', s: 'totalMoney' },
    },
    13: { 0: { v: 'Notes', s: 'heading' } },
    14: { 0: { v: 'Keep the remaining budget for our weekend trip.', s: 'note' } },
  };
  rows.forEach(([label, planned, actual], index) => {
    const row = index + 4;
    cellData[row] = {
      0: { v: label },
      1: { v: planned, s: 'money' },
      2: { v: actual, s: 'money' },
      3: { f: `=B${row + 1}-C${row + 1}`, s: 'money' },
    };
  });
  return {
    id,
    name: title,
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: {
      title: { fs: 20, bl: 1 },
      note: { fs: 11, it: 1 },
      heading: { bl: 1 },
      money: { n: { pattern: '$#,##0.00' } },
      total: { bl: 1 },
      totalMoney: { bl: 1, n: { pattern: '$#,##0.00' } },
    },
    sheetOrder: ['october', 'november'],
    sheets: {
      october: {
        id: 'october',
        name: 'October',
        rowCount: 100,
        columnCount: 12,
        defaultRowHeight: 30,
        defaultColumnWidth: 130,
        columnData: { 0: { w: 210 } },
        rowData: { 0: { h: 44 } },
        cellData,
      },
      november: {
        id: 'november',
        name: 'November',
        rowCount: 100,
        columnCount: 12,
        defaultRowHeight: 30,
        defaultColumnWidth: 130,
        columnData: { 0: { w: 210 } },
        cellData: {
          0: { 0: { v: 'November plans', s: 'title' } },
          2: { 0: { v: 'Category', s: 'heading' }, 1: { v: 'Budget', s: 'heading' } },
          3: { 0: { v: 'Weekend trip' }, 1: { v: 250, s: 'money' } },
          4: { 0: { v: 'Meals with friends' }, 1: { v: 120, s: 'money' } },
          6: { 0: { v: 'Total', s: 'total' }, 1: { f: '=SUM(B4:B5)', s: 'totalMoney' } },
        },
      },
    },
  };
}

function documentSnapshot(id: string, title: string): IDocumentData {
  const data = getDocsEmptySnapshot(id, LocaleType.EN_US, title);
  const paragraphs: [string, 'title' | 'heading' | 'body'][] = [
    ['Autumn, unhurried.', 'title'],
    ['A weekend away, a few good meals, and room for a change of plans.', 'body'],
    ['The plan', 'heading'],
    [
      'Leave after breakfast on Friday. Take the coast road, stop somewhere for lunch, and arrive before the light goes.',
      'body',
    ],
    ['A few things to make time for', 'heading'],
    ['A long walk with no particular destination.', 'body'],
    ['The little bookshop near the harbor.', 'body'],
    ['Cooking something we have never made before.', 'body'],
    ['A little room in the budget', 'heading'],
    ['We have $258.50 left for the month. A comfortable amount for a small adventure.', 'body'],
    ['Before we leave', 'heading'],
    [
      'Check the forecast. Water the plants. Download the reservations so they are with us even without a connection.',
      'body',
    ],
    ['Places to remember', 'heading'],
    [
      'The harbor cafe opens early. The path above the beach is best in the afternoon, when the wind has settled.',
      'body',
    ],
  ];
  let stream = '';
  const textRuns: NonNullable<NonNullable<IDocumentData['body']>['textRuns']> = [];
  const blocks: NonNullable<NonNullable<IDocumentData['body']>['paragraphs']> = [];
  paragraphs.forEach(([text, style], index) => {
    const start = stream.length;
    stream += `${text}\r`;
    textRuns.push({
      st: start,
      ed: start + text.length,
      ts: {
        fs: style === 'title' ? 28 : style === 'heading' ? 16 : 12,
        bl: style === 'body' ? 0 : 1,
      },
    });
    blocks.push({
      startIndex: stream.length - 1,
      paragraphId: `review-paragraph-${index}`,
      paragraphStyle: {
        namedStyleType:
          style === 'title'
            ? NamedStyleType.TITLE
            : style === 'heading'
              ? NamedStyleType.HEADING_1
              : NamedStyleType.NORMAL_TEXT,
        spaceAbove: { v: style === 'heading' ? 18 : 0 },
        spaceBelow: { v: 12 },
      },
    });
  });
  data.body = {
    ...data.body,
    dataStream: `${stream}\n`,
    paragraphs: blocks,
    textRuns,
    sectionBreaks: [{ sectionId: 'review-section', startIndex: stream.length }],
  };
  return data;
}

export function NativeEditor({
  kind,
  title,
  readOnly = false,
  onReady,
  onChange,
  getSnapshot,
  onSnapshot,
}: NativeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onChange, onSnapshot, getSnapshot });
  callbacks.current = { onReady, onChange, onSnapshot, getSnapshot };
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    const container = host.current!;
    const abort = new AbortController();
    const cleanups: (() => void)[] = [];
    let univer: Univer | undefined;
    let snapshot: (() => NativeSnapshot) | undefined;
    let stopped = false;
    const release = () => {
      if (stopped) return;
      stopped = true;
      container.inert = true;
      try {
        if (snapshot) callbacks.current.onSnapshot?.(snapshot());
      } finally {
        abort.abort();
        cleanups
          .splice(0)
          .reverse()
          .forEach((dispose) => dispose());
        // Univer owns another React root. Dispose outside this React commit;
        // the next editor's deferred initialization follows this microtask.
        queueMicrotask(() => {
          univer?.dispose();
          container.replaceChildren();
        });
      }
    };
    // Editable engines establish the browser caret while mounting. An inert
    // ancestor suppresses that selection even after focus is restored later.
    // Viewers stay fenced until their read-only permissions are installed.
    container.inert = readOnly;
    container.dataset.nativeStage = 'initializing';
    setState('loading');
    setMessage('');
    void (async () => {
      // Deferring construction avoids creating an engine in StrictMode's discarded effect.
      await Promise.resolve();
      if (stopped) return;
      const mobile = window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
      const created = createUniver({
        theme: editorTheme(),
        darkMode: getTheme() === 'dark',
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(docsEnglish, sheetsEnglish) },
        presets:
          kind === 'sheet'
            ? [sheetPreset(container, mobile)]
            : [UniverDocsCorePreset({ container, disableAutoFocus: true })],
      });
      univer = created.univer;
      installCanvasColors(univer);
      const api = created.univerAPI;
      // The old editor's cleanup may have just published a newer snapshot.
      const stored = callbacks.current.getSnapshot?.();
      const id = stored?.id ?? `review-${kind}-${crypto.randomUUID()}`;
      const name = title ?? (kind === 'sheet' ? 'Quarterly budget' : 'Autumn plans');
      const workbook =
        kind === 'sheet'
          ? api.createWorkbook(
              stored
                ? { ...structuredClone(stored as IWorkbookData), name }
                : budgetSnapshot(id, name),
            )
          : undefined;
      // Close the initial cell-entry window before asynchronous renderer setup.
      if (readOnly) workbook?.setEditable(false);
      const document =
        kind === 'doc'
          ? api.createDocument(
              stored
                ? { ...structuredClone(stored as IDocumentData), title: name }
                : documentSnapshot(id, name),
            )
          : undefined;
      snapshot = () => structuredClone(workbook ? workbook.save() : document!.save());
      container.dataset.nativeStage = 'rendering';
      const rendered = api.Enum.LifecycleStages.Rendered;
      if (api.getCurrentLifecycleStage() < rendered) {
        await new Promise<void>((resolve) => {
          const listener = api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => {
            if (stage >= rendered) {
              listener.dispose();
              resolve();
            }
          });
          cleanups.push(() => {
            listener.dispose();
            resolve();
          });
        });
      }
      if (stopped) return;
      const render = univer.__getInjector().get(IRenderManagerService).getRenderUnitById(id);
      if (render) {
        const canvas = render.engine.getCanvasElement();
        canvas.setAttribute(
          'aria-label',
          kind === 'sheet' ? 'Spreadsheet grid' : 'Document canvas',
        );
      }
      if (document) {
        container.dataset.nativeStage = 'document-layout';
        await documentReady(univer, id, abort.signal);
      }
      if (stopped) return;
      container.dataset.nativeStage = 'permissions';
      // Match the application's public local viewer fence. Do not write file
      // permission policies into snapshots or invoke an authorization provider.
      const permissions = univer.__getInjector().get(IPermissionService);
      if (readOnly && workbook) {
        workbook.setEditable(false);
        for (const Point of getAllWorkbookPermissionPoint()) {
          const point = new Point(id);
          if (!permissions.getPermissionPoint(point.id)) permissions.addPermissionPoint(point);
          permissions.updatePermissionPoint(
            point.id,
            [UnitAction.View, UnitAction.Copy, UnitAction.Print].includes(point.subType),
          );
        }
        if (workbook.getWorkbookPermission().canEdit())
          throw new Error('Could not open the read-only spreadsheet.');
      }
      if (readOnly && document) {
        setDocumentPermissionValue(permissions, id, id, UnitAction.Edit, false);
        if (document.getPermission().canEdit())
          throw new Error('Could not open the read-only document.');
      }
      if (stopped) return;
      cleanups.push(
        watchTheme(() => {
          api.setTheme(editorTheme());
          api.toggleDarkMode(getTheme() === 'dark');
          if (workbook)
            for (const skeleton of univer!
              .__getInjector()
              .get(SheetSkeletonService)
              .getSkeletonsByUnitId(id))
              skeleton.makeDirty(true);
          workbook?.getActiveSheet()?.refreshCanvas();
        }),
      );
      const change = api.addEvent(api.Event.CommandExecuted, (event) => {
        if (!readOnly && event.type === CommandType.MUTATION && event.params?.unitId === id)
          callbacks.current.onChange?.();
      });
      cleanups.push(() => change.dispose());
      container.dataset.nativeStage = 'ready';
      setState('ready');
      callbacks.current.onReady?.({
        api,
        getSnapshot: snapshot,
        canEdit: () =>
          workbook
            ? workbook.getWorkbookPermission().canEdit()
            : document!.getPermission().canEdit(),
      });
    })().catch((error: unknown) => {
      if (stopped) return;
      container.dataset.nativeStage = 'error';
      setMessage(error instanceof Error ? error.message : 'Could not open the editor.');
      setState('error');
      release();
    });
    return release;
  }, [kind, title, readOnly]);
  return (
    <section
      className="rd-native-editor"
      aria-label={kind === 'sheet' ? 'Spreadsheet editor' : 'Document editor'}
      data-native-ready={state === 'ready'}
      aria-busy={state === 'loading'}
    >
      <div
        ref={host}
        className="rd-native-host"
        aria-hidden={(readOnly && state !== 'ready') || state === 'error'}
        {...(readOnly && state !== 'ready' ? { inert: true } : {})}
      />
      {state !== 'ready' && (
        <div
          className={`rd-native-message ${!readOnly && state === 'loading' ? 'rd-native-loading-editable' : ''}`}
          role={state === 'error' ? 'alert' : undefined}
        >
          {state === 'error' ? (
            message
          ) : (
            <LoadingReview
              label={`Opening ${kind === 'sheet' ? 'spreadsheet' : 'document'}…`}
              size={readOnly ? 'page' : 'compact'}
            />
          )}
        </div>
      )}
    </section>
  );
}
