/** Shared process-global native Canvas boundary for every standalone print format. */
import { createCanvas, Image, Path2D } from '@napi-rs/canvas';
import { UniverPrintingContext } from '@univerjs/engine-render';
import { PrintError } from './contract.ts';

let rendering = false;

/** Reject overlap across Docs and Sheets before either changes native state. */
export function acquireNativeRender(): () => void {
  if (rendering)
    throw new PrintError('limit', 'A native PDF render is already active in this worker.');
  rendering = true;
  return () => {
    rendering = false;
  };
}

export class PdfContext extends UniverPrintingContext {
  private readonly checkpoint: (() => void) | undefined;
  constructor(raw: CanvasRenderingContext2D, checkpoint?: () => void) {
    super(raw);
    this.checkpoint = checkpoint;
  }
  override save() {
    this.checkpoint?.();
    super.save();
  }
  override fillText(text: string, x: number, y: number, maxWidth?: number) {
    this.checkpoint?.();
    super.fillText(text, x, y, maxWidth);
  }
  override fillTextPrecision(text: string, x: number, y: number, maxWidth?: number) {
    this.checkpoint?.();
    super.fillTextPrecision(text, x, y, maxWidth);
  }
  override strokeText(text: string, x: number, y: number, maxWidth?: number) {
    this.checkpoint?.();
    super.strokeText(text, x, y, maxWidth);
  }
  override fillRect(x: number, y: number, width: number, height: number) {
    this.checkpoint?.();
    super.fillRect(x, y, width, height);
  }
  override stroke() {
    this.checkpoint?.();
    super.stroke();
  }
  override setLineDash(segments: number[]) {
    // Canvas permits an all-zero dash array; the native PDF backend rejects it.
    super.setLineDash(segments.every((value) => value === 0) ? [] : segments);
  }
}

/** Install only for the serialized native operation and restore exact descriptors. */
export function canvasGlobals(pixelLimit: number, check: () => void) {
  const names = ['OffscreenCanvas', 'Image', 'Path2D'] as const;
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const restore = () => {
    names.forEach((name, index) => {
      if (saved[index]) Object.defineProperty(globalThis, name, saved[index]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  };
  const nativeSource = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  if (!nativeSource?.set || !nativeSource.get)
    throw new PrintError('unsupported', 'The native PDF image adapter is unavailable.');
  class LocalImage extends Image {
    constructor() {
      super();
      Object.defineProperty(this, 'src', {
        get: () => nativeSource!.get!.call(this),
        set: (value: unknown) => {
          check();
          // The native Font extension creates a fixed inline SVG fallback even
          // without cell images. Decode inline bytes only; never pass a string
          // (which the canvas API can interpret as a file/URL) to native Image.
          if (
            typeof value === 'string' &&
            value.length <= 16_384 &&
            /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(value)
          ) {
            nativeSource!.set!.call(
              this,
              Buffer.from(value.slice(value.indexOf(',') + 1), 'base64'),
            );
          } else if (value instanceof Uint8Array) nativeSource!.set!.call(this, value);
          else throw new PrintError('unsupported', 'Native PDF images require prepared bytes.');
        },
      });
    }
  }
  class BoundedCanvas {
    constructor(width: number, height: number) {
      check();
      if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 0 ||
        height < 0 ||
        !Number.isSafeInteger(width * height) ||
        width * height > pixelLimit
      )
        throw new PrintError('limit', 'PDF canvas exceeds its pixel budget.');
      return createCanvas(width, height);
    }
  }
  try {
    for (const [name, value] of Object.entries({
      OffscreenCanvas: BoundedCanvas,
      Image: LocalImage,
      Path2D,
    }))
      Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch {
    restore();
    throw new PrintError('unsupported', 'The native PDF canvas environment is unavailable.');
  }
  return restore;
}
