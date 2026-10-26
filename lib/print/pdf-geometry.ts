import { PRINT_LIMITS, PrintError } from './contract.ts';

function unsupported(): never {
  throw new PrintError('unsupported', 'Native PDF page geometry cannot be preserved.');
}

/**
 * Skia quantizes page canvases to whole points. Draw on ceil-sized canvases with
 * a top translation of ceil(height)-height, then preserve the exact stored frame
 * with a standard incremental PDF update. Only this pinned backend's plain xref
 * output is accepted. Streams and original byte offsets are never rewritten.
 * This is not an importer or a general PDF parser.
 */
export function preservePdfPageGeometry(
  bytes: Uint8Array,
  width: number,
  height: number,
  expectedPages: number,
  check: () => void = () => {},
): Uint8Array {
  check();
  if (
    ![width, height].every((value) => Number.isFinite(value) && value >= 1 && value <= 100_000) ||
    !Number.isSafeInteger(expectedPages) ||
    expectedPages < 1 ||
    expectedPages > PRINT_LIMITS.pages
  )
    unsupported();
  if (bytes.length > PRINT_LIMITS.outputBytes)
    throw new PrintError('limit', 'PDF output exceeds its byte budget.');
  // Latin-1 preserves one string position per original byte, including streams.
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const ending = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(source.slice(-256));
  if (!ending || !source.startsWith('%PDF-')) unsupported();
  const oldXref = Number(ending[1]);
  if (!Number.isSafeInteger(oldXref) || oldXref < 8 || oldXref >= source.length) unsupported();
  const section = source.slice(oldXref);
  const header = /^xref\r?\n0 (\d+)\r?\n/.exec(section);
  if (!header) unsupported();
  const count = Number(header[1]);
  if (!Number.isSafeInteger(count) || count < 2 || count > PRINT_LIMITS.snapshotNodes)
    unsupported();
  const objects: { id: number; offset: number }[] = [];
  let cursor = header[0].length;
  for (let id = 0; id < count; id++) {
    check();
    const line = /^(\d{10}) (\d{5}) ([nf]) \r?\n/.exec(section.slice(cursor, cursor + 22));
    if (!line) unsupported();
    cursor += line[0].length;
    const offset = Number(line[1]);
    if (id === 0) {
      if (offset !== 0 || line[2] !== '65535' || line[3] !== 'f') unsupported();
    } else {
      if (line[2] !== '00000' || line[3] !== 'n' || offset < 8 || offset >= oldXref) unsupported();
      objects.push({ id, offset });
    }
  }
  const trailer =
    /^trailer\s*<<\s*\/Size (\d+)\s+\/Root (\d+) 0 R(?:\s+\/Info (\d+) 0 R)?\s*>>\s*startxref\s+(\d+)\s+%%EOF\s*$/.exec(
      section.slice(cursor),
    );
  if (
    !trailer ||
    Number(trailer[1]) !== count ||
    Number(trailer[4]) !== oldXref ||
    Number(trailer[2]) < 1 ||
    Number(trailer[2]) >= count ||
    (trailer[3] !== undefined && (Number(trailer[3]) < 1 || Number(trailer[3]) >= count))
  )
    unsupported();
  objects.sort((a, b) => a.offset - b.offset);
  const pages: { id: number; body: string }[] = [];
  for (let index = 0; index < objects.length; index++) {
    check();
    const object = objects[index];
    const end = objects[index + 1]?.offset ?? oldXref;
    if (end <= object.offset) unsupported();
    const raw = source.slice(object.offset, end);
    const prefix = `${object.id} 0 obj\n`;
    if (!raw.startsWith(prefix) || !/endobj\s*$/.test(raw)) unsupported();
    const body = raw.slice(prefix.length).replace(/\s*endobj\s*$/, '');
    // A stream may contain arbitrary bytes resembling page dictionaries; only
    // dictionaries at validated xref offsets, with no stream body, are examined.
    if (/\bstream(?:\r?\n)/.test(body) || !/\/Type\s*\/Page\b/.test(body)) continue;
    if (
      body.length > 65_536 ||
      !body.startsWith('<<') ||
      !body.endsWith('>>') ||
      /\/(?:CropBox|Rotate|UserUnit)\b/.test(body)
    )
      unsupported();
    const frames = [...body.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+(\d+)\s+(\d+)\s*\]/g)];
    if (
      frames.length !== 1 ||
      Number(frames[0][1]) !== Math.ceil(width) ||
      Number(frames[0][2]) !== Math.ceil(height)
    )
      unsupported();
    pages.push({
      id: object.id,
      body: body.replace(frames[0][0], `/MediaBox [0 0 ${width} ${height}]`),
    });
  }
  if (pages.length !== expectedPages) unsupported();
  if (Number.isInteger(width) && Number.isInteger(height)) return bytes;
  const additions: string[] = ['\n'];
  let size = bytes.length + 1;
  const offsets: { id: number; offset: number }[] = [];
  for (const page of pages) {
    check();
    const entry = `${page.id} 0 obj\n${page.body}\nendobj\n`;
    offsets.push({ id: page.id, offset: size });
    size += entry.length;
    if (size > PRINT_LIMITS.outputBytes)
      throw new PrintError('limit', 'PDF output exceeds its byte budget.');
    additions.push(entry);
  }
  const newXref = size;
  additions.push('xref\n');
  for (const { id, offset } of offsets.sort((a, b) => a.id - b.id))
    additions.push(`${id} 1\n${String(offset).padStart(10, '0')} 00000 n \n`);
  additions.push(
    `trailer\n<</Size ${count}\n/Root ${trailer[2]} 0 R\n` +
      (trailer[3] ? `/Info ${trailer[3]} 0 R\n` : '') +
      `/Prev ${oldXref}>>\nstartxref\n${newXref}\n%%EOF\n`,
  );
  const tail = Buffer.from(additions.join(''), 'latin1');
  if (bytes.length + tail.length > PRINT_LIMITS.outputBytes)
    throw new PrintError('limit', 'PDF output exceeds its byte budget.');
  check();
  return Buffer.concat([bytes, tail]);
}
