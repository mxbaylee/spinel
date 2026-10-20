import { describe, expect, it } from 'vitest';
import { parseBodySelection } from './selection.ts';

describe('prototype body selection', () => {
  it('accepts a caret and forward text range', () => {
    expect(parseBodySelection('3:3:1:TEXT::-1')).toMatchObject({ startOffset: 3, endOffset: 3 });
    expect(parseBodySelection('3:8:1:TEXT::-1')).toMatchObject({ startOffset: 3, endOffset: 8 });
  });
  it('rejects unsafe offsets and unsupported segments', () => {
    for (const value of [
      '8:3:1:TEXT::-1',
      '-1:3:1:TEXT::-1',
      '0:9007199254740992:1:TEXT::-1',
      '0:3:1:TEXT:header:-1',
      'sheet!A1',
    ])
      expect(parseBodySelection(value)).toBeNull();
  });
});
