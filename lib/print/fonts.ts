import { PrintError } from './contract.ts';
import type { PreparedFont, PrintLimits } from './contract.ts';

interface FontFace {
  family: string;
  alias: string;
  weight: 400 | 700;
  italic: boolean;
  bytes: Buffer;
  covers: (point: number) => boolean;
}

export interface FontRun {
  start: number;
  end: number;
  family: string;
}

function invalid(): never {
  throw new PrintError('invalid-input', 'Invalid or unsupported prepared PDF font.');
}

/** Bounded SFNT cmap reader, not a font shaper. Native registration still validates the face. */
function fontCoverage(bytes: Buffer, weight: number, italic: boolean): FontFace['covers'] {
  if (bytes.length < 12 || ![0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(0))) invalid();
  const count = bytes.readUInt16BE(4);
  if (!count || count > 256 || 12 + count * 16 > bytes.length) invalid();
  const tables = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const start = 12 + i * 16;
    const tag = bytes.toString('ascii', start, start + 4);
    const offset = bytes.readUInt32BE(start + 8);
    const length = bytes.readUInt32BE(start + 12);
    if (offset > bytes.length || length > bytes.length - offset || tables.has(tag)) invalid();
    tables.set(tag, bytes.subarray(offset, offset + length));
  }
  // Static, explicitly supplied faces avoid implicit host-dependent variation selection.
  if (tables.has('fvar')) invalid();
  const os2 = tables.get('OS/2');
  const maxp = tables.get('maxp');
  const cmap = tables.get('cmap');
  if (!os2 || os2.length < 64 || !maxp || maxp.length < 6 || !cmap || cmap.length < 4) invalid();
  const embedding = os2.readUInt16BE(8);
  if (embedding & (0x0002 | 0x0100 | 0x0200))
    throw new PrintError(
      'unsupported',
      'PDF font does not permit the required scalable subset embedding.',
    );
  if (os2.readUInt16BE(4) !== weight || Boolean(os2.readUInt16BE(62) & 1) !== italic) invalid();
  const glyphCount = maxp.readUInt16BE(4);
  if (!glyphCount) invalid();
  const encodings = cmap.readUInt16BE(2);
  if (!encodings || encodings > 64 || 4 + encodings * 8 > cmap.length) invalid();
  const readers: ((point: number) => number)[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < encodings; i++) {
    const entry = 4 + i * 8;
    const platform = cmap.readUInt16BE(entry);
    const encoding = cmap.readUInt16BE(entry + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const offset = cmap.readUInt32BE(entry + 4);
    if (offset + 2 > cmap.length) invalid();
    if (seen.has(offset)) continue;
    seen.add(offset);
    const format = cmap.readUInt16BE(offset);
    if (format === 12) {
      if (offset + 16 > cmap.length) invalid();
      const length = cmap.readUInt32BE(offset + 4);
      const groups = cmap.readUInt32BE(offset + 12);
      if (
        length < 16 ||
        length > cmap.length - offset ||
        groups > 100_000 ||
        16 + groups * 12 > length
      )
        invalid();
      const table = cmap.subarray(offset, offset + length);
      let previous = -1;
      for (let j = 0; j < groups; j++) {
        const start = table.readUInt32BE(16 + j * 12);
        const end = table.readUInt32BE(20 + j * 12);
        const glyph = table.readUInt32BE(24 + j * 12);
        if (start <= previous || end < start || end > 0x10ffff || glyph + end - start >= glyphCount)
          invalid();
        previous = end;
      }
      readers.push((point) => {
        let low = 0;
        let high = groups - 1;
        while (low <= high) {
          const middle = (low + high) >>> 1;
          const start = table.readUInt32BE(16 + middle * 12);
          const end = table.readUInt32BE(20 + middle * 12);
          if (point < start) high = middle - 1;
          else if (point > end) low = middle + 1;
          else return table.readUInt32BE(24 + middle * 12) + point - start;
        }
        return 0;
      });
    } else if (format === 4) {
      if (offset + 16 > cmap.length) invalid();
      const length = cmap.readUInt16BE(offset + 2);
      const segments = cmap.readUInt16BE(offset + 6) / 2;
      if (
        !Number.isInteger(segments) ||
        !segments ||
        segments > 8192 ||
        length < 16 + segments * 8 ||
        length > cmap.length - offset
      )
        invalid();
      const table = cmap.subarray(offset, offset + length);
      const startBase = 16 + segments * 2;
      const deltaBase = 16 + segments * 4;
      const rangeBase = 16 + segments * 6;
      let previous = -1;
      for (let j = 0; j < segments; j++) {
        const start = table.readUInt16BE(startBase + j * 2);
        const end = table.readUInt16BE(14 + j * 2);
        const range = table.readUInt16BE(rangeBase + j * 2);
        if (
          start <= previous ||
          end < start ||
          (range && rangeBase + j * 2 + range + (end - start) * 2 + 2 > length)
        )
          invalid();
        previous = end;
      }
      readers.push((point) => {
        if (point > 0xffff) return 0;
        let low = 0;
        let high = segments - 1;
        while (low <= high) {
          const middle = (low + high) >>> 1;
          const start = table.readUInt16BE(startBase + middle * 2);
          const end = table.readUInt16BE(14 + middle * 2);
          if (point < start) high = middle - 1;
          else if (point > end) low = middle + 1;
          else {
            const delta = table.readInt16BE(deltaBase + middle * 2);
            const range = table.readUInt16BE(rangeBase + middle * 2);
            const glyph = range
              ? table.readUInt16BE(rangeBase + middle * 2 + range + (point - start) * 2)
              : point;
            return range && !glyph ? 0 : (glyph + delta) & 0xffff;
          }
        }
        return 0;
      });
    }
  }
  if (!readers.length) invalid();
  return (point) =>
    readers.some((read) => {
      const glyph = read(point);
      return glyph > 0 && glyph < glyphCount;
    });
}

export class PreparedFonts {
  readonly faces: FontFace[] = [];
  private names = new Map<string, string>();
  private fallback: string[];
  private primary: string;

  constructor(
    fonts: readonly PreparedFont[],
    defaultFamily: string,
    fallbackFamilies: readonly string[],
    limits: Readonly<PrintLimits>,
  ) {
    if (
      !Array.isArray(fonts) ||
      !fonts.length ||
      fonts.length > limits.fonts ||
      !Array.isArray(fallbackFamilies) ||
      fallbackFamilies.length > limits.fonts
    )
      invalid();
    let total = 0;
    for (const font of fonts) {
      if (
        !font ||
        typeof font.family !== 'string' ||
        !font.family.trim() ||
        font.family.length > 256 ||
        ![400, 700].includes(font.weight) ||
        typeof font.italic !== 'boolean' ||
        !(font.bytes instanceof Uint8Array) ||
        !font.bytes.byteLength ||
        !font.license ||
        !['identifier', 'text', 'source'].every(
          (key) =>
            typeof font.license[key as keyof PreparedFont['license']] === 'string' &&
            font.license[key as keyof PreparedFont['license']].length > 0 &&
            font.license[key as keyof PreparedFont['license']].length <= 64_000,
        )
      )
        invalid();
      total += font.bytes.byteLength;
      if (total > limits.fontBytes)
        throw new PrintError('limit', 'PDF fonts exceed their byte budget.');
      const family = font.family.trim().toLowerCase();
      if (
        this.faces.some(
          (face) =>
            face.family === family && face.weight === font.weight && face.italic === font.italic,
        )
      )
        invalid();
      const aliases = font.aliases ?? [];
      if (!Array.isArray(aliases) || aliases.length > 16) invalid();
      for (const name of [font.family, ...aliases]) {
        if (typeof name !== 'string' || !name.trim() || name.length > 256) invalid();
        const key = name.trim().toLowerCase();
        if (this.names.has(key) && this.names.get(key) !== family) invalid();
        this.names.set(key, family);
      }
      const bytes = Buffer.from(font.bytes);
      const alias =
        this.faces.find((face) => face.family === family)?.alias ?? `PrintFont${this.faces.length}`;
      this.faces.push({
        family,
        alias,
        weight: font.weight,
        italic: font.italic,
        bytes,
        covers: fontCoverage(bytes, font.weight, font.italic),
      });
    }
    this.primary = this.resolve(defaultFamily);
    this.fallback = fallbackFamilies.map((family) => this.resolve(family));
    if (new Set(this.fallback).size !== this.fallback.length) invalid();
  }

  private resolve(family: string) {
    if (typeof family !== 'string') invalid();
    const resolved = this.names.get(family.trim().toLowerCase());
    if (!resolved)
      throw new PrintError('unsupported', 'A PDF font family has no explicitly prepared face.');
    return resolved;
  }

  /** Resolve whole graphemes, preserving shaping sequences and UTF-16 text-run indices. */
  runs(text: string, family: string | undefined, bold = false, italic = false): FontRun[] {
    const requested = family ? this.resolve(family) : this.primary;
    const candidates = [requested, ...this.fallback]
      .map((name) =>
        this.faces.find(
          (face) =>
            face.family === name && face.weight === (bold ? 700 : 400) && face.italic === italic,
        ),
      )
      .filter((face): face is FontFace => Boolean(face));
    if (!candidates.length)
      throw new PrintError('unsupported', 'A PDF font style has no explicitly prepared face.');
    const runs: FontRun[] = [];
    for (const { segment, index } of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(
      text,
    )) {
      // Native rich-text separators, inline image placeholders and shaping controls have no visible glyph.
      const points = [...segment]
        .map((char) => char.codePointAt(0)!)
        .filter(
          (point) =>
            point >= 0x20 &&
            point !== 0xfffc &&
            !/\p{Default_Ignorable_Code_Point}/u.test(String.fromCodePoint(point)),
        );
      const face = candidates.find((candidate) => points.every((point) => candidate.covers(point)));
      if (!face)
        throw new PrintError(
          'unsupported',
          'A PDF text grapheme has no supported prepared font glyphs.',
        );
      const previous = runs.at(-1);
      if (previous?.family === face.alias) previous.end = index + segment.length;
      else runs.push({ start: index, end: index + segment.length, family: face.alias });
    }
    return runs.length ? runs : [{ start: 0, end: 0, family: candidates[0].alias }];
  }
}
