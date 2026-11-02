import { createHash } from 'node:crypto';

/** Retain public mirror lines exactly; unknown text is never copied into CI logs. */
export function ubuntuMirrorEvidence(original: string) {
  return {
    bytes: Buffer.byteLength(original),
    sha256: createHash('sha256').update(original).digest('hex'),
    lines: original.split('\n').map((line, index) => ({
      line: index + 1,
      text: /^[ \t]*(?:https?:\/\/(?:[a-z0-9-]+\.)*ubuntu\.com\/ubuntu\/?[ \t]+priority:[0-9]+[ \t]*)?\r?$/.test(
        line,
      )
        ? line
        : '[unsupported line redacted]',
    })),
  };
}
