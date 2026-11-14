import { LocaleType } from '@univerjs/core';
import type { IWorkbookData } from '@univerjs/core';

/** Both sides of the native Copy boundary for story/browser menu verification. */
export function syncSheetMenuFixture(largeFirst = false): IWorkbookData {
  return {
    id: 'sheet-menu-review',
    name: 'Sheet menus',
    appVersion: '1.1.0',
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: largeFirst ? ['large', 'small'] : ['small', 'large'],
    sheets: {
      small: {
        id: 'small',
        name: 'Small sheet',
        rowCount: 100,
        columnCount: 26,
        cellData: { 0: { 0: { v: 'Copy remains available' }, 1: { v: 5 }, 2: { f: '=B1*2' } } },
      },
      large: {
        id: 'large',
        name: 'Large sheet',
        rowCount: 300,
        columnCount: 26,
        cellData: Object.fromEntries(
          Array.from({ length: 300 }, (_, row) => [
            row,
            Object.fromEntries(
              Array.from({ length: 20 }, (_, column) => [column, { v: row * 20 + column }]),
            ),
          ]),
        ),
      },
    },
  };
}
