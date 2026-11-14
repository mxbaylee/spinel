// Story-only readiness for the modern phone Doc's incremental native layout.
export interface MobileDocStoryLayout {
  hasCompleteLayout: boolean;
  layoutPending: boolean;
  coversContentEnd: boolean;
  mountWidth: number;
  canvasWidth: number;
  bitmapWidth: number;
  pixelRatio: number;
  nativeWidth: number;
  pageWidths: readonly number[];
  pageMarginLeft: number;
}

export function mobileDocStoryLayoutReady(layout: MobileDocStoryLayout): boolean {
  // hasCompleteLayout() alone also accepts a previous completed generation while
  // its replacement is running. Successful native completion clears progress.
  if (!layout.hasCompleteLayout || layout.layoutPending || !layout.coversContentEnd) return false;
  const { mountWidth, canvasWidth, bitmapWidth, pixelRatio, nativeWidth, pageMarginLeft } = layout;
  if (
    ![mountWidth, canvasWidth, bitmapWidth, pixelRatio, nativeWidth].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    !Number.isFinite(pageMarginLeft) ||
    pageMarginLeft < 0
  )
    return false;
  // ResizeObserver and native idle resizing can lag behind the surrounding DOM.
  // Modern mobile pages fill the native width inside the renderer's own margin.
  return (
    Math.abs(canvasWidth - mountWidth) <= 1 &&
    Math.abs(nativeWidth - mountWidth) <= 1 &&
    Math.abs(bitmapWidth - Math.round(mountWidth * pixelRatio)) <= 1 &&
    layout.pageWidths.length > 0 &&
    layout.pageWidths.every(
      (width) =>
        Number.isFinite(width) &&
        width > 0 &&
        Math.abs(width + 2 * pageMarginLeft - nativeWidth) <= 1,
    )
  );
}
