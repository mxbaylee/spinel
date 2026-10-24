import sharp from 'sharp';
import { PrintError, printCheckpoint } from './contract.ts';
import type { PreparedImage, PrintLimits } from './contract.ts';

export interface AdmittedImage {
  /** Owned byte copy; a caller cannot mutate it while native decoding is pending. */
  bytes: Buffer;
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
}

function imageFormat(bytes: Uint8Array): AdmittedImage['format'] {
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'webp';
  throw new PrintError('unsupported', 'PDF images must be static PNG, JPEG or WebP bytes.');
}

/**
 * Header inspection only, before native raster decoding. Complete decode validation
 * still belongs to the renderer. No string is passed to an image decoder as a path.
 */
export async function admitImages(
  sources: readonly string[],
  prepared: readonly PreparedImage[],
  limits: Readonly<PrintLimits>,
  deadline: number,
  signal?: AbortSignal,
): Promise<Map<string, AdmittedImage>> {
  const check = () => printCheckpoint(signal, deadline);
  check();
  if (!Array.isArray(prepared) || prepared.length > limits.images || sources.length > limits.images)
    throw new PrintError('limit', 'PDF has too many image inputs.');
  const inputs = new Map<string, Uint8Array>();
  let encodedBytes = 0;
  for (const input of prepared) {
    check();
    if (
      !input ||
      typeof input.source !== 'string' ||
      !input.source ||
      !(input.bytes instanceof Uint8Array) ||
      !input.bytes.byteLength ||
      inputs.has(input.source)
    )
      throw new PrintError('invalid-input', 'Invalid or duplicate prepared PDF image.');
    if (Buffer.byteLength(input.source, 'utf8') > limits.snapshotBytes)
      throw new PrintError('limit', 'PDF image reference is too large.');
    encodedBytes += input.bytes.byteLength;
    if (encodedBytes > limits.encodedImageBytes)
      throw new PrintError('limit', 'PDF images exceed their encoded byte budget.');
    imageFormat(input.bytes);
    inputs.set(input.source, input.bytes);
  }
  const required = new Set(sources);
  for (const source of required)
    if (typeof source !== 'string' || !inputs.has(source))
      throw new PrintError('invalid-input', 'A PDF image has no authorized prepared bytes.');
  // Own every required input before the first await; callers retain no mutable alias.
  const copies = new Map([...required].map((source) => [source, Buffer.from(inputs.get(source)!)]));
  const admitted = new Map<string, AdmittedImage>();
  let pixels = 0;
  for (const [source, bytes] of copies) {
    check();
    const format = imageFormat(bytes);
    let metadata;
    const image = sharp(bytes, {
      limitInputPixels: limits.decodedImagePixels,
      failOn: 'error',
      sequentialRead: true,
    });
    try {
      metadata = await image.metadata();
    } catch {
      throw new PrintError('invalid-input', 'A PDF image is invalid or exceeds its pixel limit.');
    } finally {
      image.destroy();
    }
    check();
    const { width, height } = metadata;
    if (
      metadata.format !== format ||
      !width ||
      !height ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      (metadata.pages ?? 1) !== 1
    )
      throw new PrintError(
        'invalid-input',
        'A PDF image has invalid dimensions or multiple frames.',
      );
    pixels += width * height;
    if (!Number.isSafeInteger(pixels) || pixels > limits.decodedImagePixels)
      throw new PrintError('limit', 'PDF images exceed their aggregate decoded pixel budget.');
    admitted.set(source, { bytes, width, height, format });
  }
  return admitted;
}
