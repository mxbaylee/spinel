export interface DrawingGeometry {
  hostWidth: number;
  canvasWidth: number;
  engineWidth: number;
  engineHeight: number;
  resized: number;
  controlsCreated: number;
}

export interface DrawingGeometryEvent extends DrawingGeometry {
  sequence: number;
}

export interface DrawingResizeObservation {
  phase: 'narrow' | 'restore';
  targetWidth: number;
  before: DrawingGeometry;
  current: DrawingGeometry;
  resize?: DrawingGeometryEvent;
  controls?: DrawingGeometryEvent;
}

/** Width completion and its subsequent native control refresh, not any resize activity. */
export function nativeDrawingResizeComplete(
  observation: DrawingResizeObservation | undefined,
  phase: DrawingResizeObservation['phase'],
) {
  if (!observation || observation.phase !== phase) return false;
  const { targetWidth, before, current, resize, controls } = observation;
  // Native dimensions use integer CSS pixels; the host can have fractional bounds.
  const atTarget = (geometry: DrawingGeometry) =>
    [geometry.hostWidth, geometry.canvasWidth, geometry.engineWidth].every(
      (width) => Number.isFinite(width) && Math.abs(width - targetWidth) <= 1,
    );
  return Boolean(
    Number.isFinite(targetWidth) &&
    targetWidth > 0 &&
    Math.abs(before.hostWidth - targetWidth) > 1 &&
    atTarget(current) &&
    current.resized > before.resized &&
    current.controlsCreated > before.controlsCreated &&
    resize &&
    resize.resized > before.resized &&
    atTarget(resize) &&
    controls &&
    controls.controlsCreated > before.controlsCreated &&
    controls.sequence > resize.sequence &&
    atTarget(controls),
  );
}
