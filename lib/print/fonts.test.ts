import { expect, test } from 'vitest';
import { PRINT_LIMITS } from './index.ts';
import { PreparedFonts } from './fonts.ts';
import { fixtureFonts } from './font-fixtures.ts';

test('admits licensed regular/bold/italic faces with deterministic aliases and Unicode runs', async () => {
  const input = await fixtureFonts();
  const fonts = new PreparedFonts(input, 'Atkinson Hyperlegible', ['Noto Sans Symbols 2'], PRINT_LIMITS);
  for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]])
    expect(fonts.runs('Budget café', undefined, bold, italic)).toEqual([{ start: 0, end: 11, family: 'PrintFont0' }]);
  const text = 'Card 🂡';
  const runs = fonts.runs(text, undefined);
  expect(runs).toEqual([{ start: 0, end: 5, family: 'PrintFont0' }, { start: 5, end: 7, family: 'PrintFont4' }]);
  expect(fonts.faces[0].bytes).not.toBe(input[0].bytes);
});

test('never substitutes system fonts or missing glyphs, families or styles silently', async () => {
  const input = await fixtureFonts();
  const fonts = new PreparedFonts(input, 'Atkinson Hyperlegible', [], PRINT_LIMITS);
  expect(() => fonts.runs(String.fromCodePoint(0x10ffff), undefined)).toThrow('glyphs');
  expect(() => fonts.runs('Text', 'Unprepared family')).toThrow('prepared face');
  const regularOnly = new PreparedFonts([input[0]], 'Atkinson Hyperlegible', [], PRINT_LIMITS);
  expect(() => regularOnly.runs('Bold', undefined, true)).toThrow('font style');
  expect(() => new PreparedFonts([{ ...input[0], weight: 700 }], 'Atkinson Hyperlegible', [], PRINT_LIMITS)).toThrow('prepared PDF font');
});

test('rejects forbidden embedding and font-byte overflows before native registration', async () => {
  const input = await fixtureFonts();
  expect(() => new PreparedFonts(input, 'Atkinson Hyperlegible', [], { ...PRINT_LIMITS, fontBytes: input[0].bytes.byteLength - 1 })).toThrow('byte budget');
  const bytes = Buffer.from(input[0].bytes);
  const tables = bytes.readUInt16BE(4);
  let os2 = -1;
  for (let i = 0; i < tables; i++) {
    const entry = 12 + i * 16;
    if (bytes.toString('ascii', entry, entry + 4) === 'OS/2') os2 = bytes.readUInt32BE(entry + 8);
  }
  expect(os2).toBeGreaterThan(0);
  for (const flags of [0x0002, 0x0100, 0x0200]) {
    bytes.writeUInt16BE(flags, os2 + 8);
    expect(() => new PreparedFonts([{ ...input[0], bytes }], 'Atkinson Hyperlegible', [], PRINT_LIMITS)).toThrow('embedding');
  }
});

test('rejects malformed font table ranges and conflicting aliases without exposing text', async () => {
  const input = await fixtureFonts();
  const malformed = Buffer.from(input[0].bytes);
  malformed.writeUInt32BE(0xffffffff, 20);
  expect(() => new PreparedFonts([{ ...input[0], bytes: malformed }], 'Atkinson Hyperlegible', [], PRINT_LIMITS)).toThrow('prepared PDF font');
  expect(() => new PreparedFonts([...input, { ...input[4], family: 'Other', aliases: ['Atkinson Hyperlegible'] }], 'Atkinson Hyperlegible', [], PRINT_LIMITS)).toThrow('prepared PDF font');
});
