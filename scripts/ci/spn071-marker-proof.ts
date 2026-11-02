// Investigation only: recognize the existing core patch's exact native marker.
export function markerAwareBalanced(source: string, _format: 'es' | 'cjs') {
  const before = '["dataStream", "textRuns", "paragraphs", "customRanges", "customDecorations", "customBlocks", "sectionBreaks"]';
  if (source.split(before).length !== 2) throw new Error('Expected existing body qualifier.');
  return source.replace(before, before.slice(0, -1) + ', "__textXPreserveParagraphIds"]')
    .replace('\t\t// The SDK\'s structural tokens', '\t\tif (Object.hasOwn(body, "__textXPreserveParagraphIds") && body.__textXPreserveParagraphIds !== true) return false;\n\t\t// The SDK\'s structural tokens');
}
