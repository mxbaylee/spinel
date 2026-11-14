import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  nativeDrawingResizeComplete,
  type DrawingGeometry,
  type DrawingResizeObservation,
} from '../../web/nativeDrawingResize.ts';

const geometry = (width: number, resized: number, controlsCreated: number): DrawingGeometry => ({
  hostWidth: width,
  canvasWidth: width,
  engineWidth: width,
  engineHeight: 578,
  resized,
  controlsCreated,
});

function completed(phase: DrawingResizeObservation['phase']): DrawingResizeObservation {
  const targetWidth = phase === 'narrow' ? 1272 : 1280;
  return {
    phase,
    targetWidth,
    before: geometry(phase === 'narrow' ? 1280 : 1272, 2, 2),
    current: geometry(targetWidth, 3, 4),
    resize: { ...geometry(targetWidth, 3, 3), sequence: 7 },
    controls: { ...geometry(targetWidth, 3, 4), sequence: 8 },
  };
}

describe.each(['narrow', 'restore'] as const)('%s native drawing transition', (phase) => {
  test('completes only after native width and its drawing controls refresh', () => {
    expect(nativeDrawingResizeComplete(completed(phase), phase)).toBe(true);
  });

  test('rejects missing width work despite unrelated native resize and control increments', () => {
    const observation = completed(phase);
    // The bounded native controls demonstrated this exact false-positive boundary:
    // height-only activity advances both counters without the requested width.
    const wrongWidth = observation.before.hostWidth;
    observation.current = { ...geometry(wrongWidth, 3, 4), engineHeight: 570 };
    observation.resize = { ...geometry(wrongWidth, 3, 3), sequence: 7 };
    observation.controls = { ...geometry(wrongWidth, 3, 4), sequence: 8 };
    expect(observation.current.resized).toBeGreaterThan(observation.before.resized);
    expect(observation.current.controlsCreated).toBeGreaterThan(observation.before.controlsCreated);
    expect(nativeDrawingResizeComplete(observation, phase)).toBe(false);
  });

  test('rejects host-only readiness while the native canvas is still at the old width', () => {
    const observation = completed(phase);
    observation.current.canvasWidth = observation.before.canvasWidth;
    observation.current.engineWidth = observation.before.engineWidth;
    expect(nativeDrawingResizeComplete(observation, phase)).toBe(false);
  });

  test('rejects a control refresh from before the requested native resize', () => {
    const observation = completed(phase);
    observation.controls!.sequence = observation.resize!.sequence - 1;
    expect(nativeDrawingResizeComplete(observation, phase)).toBe(false);
  });

  test('rejects missing native events even if current geometry already matches', () => {
    const observation = completed(phase);
    expect(nativeDrawingResizeComplete({ ...observation, resize: undefined }, phase)).toBe(false);
    expect(nativeDrawingResizeComplete({ ...observation, controls: undefined }, phase)).toBe(false);
    observation.controls!.controlsCreated = observation.before.controlsCreated;
    expect(nativeDrawingResizeComplete(observation, phase)).toBe(false);
  });

  test('rejects an unrelated event at the old width despite a later matching sample', () => {
    const observation = completed(phase);
    observation.resize!.engineWidth = observation.before.engineWidth;
    expect(nativeDrawingResizeComplete(observation, phase)).toBe(false);
    observation.resize = completed(phase).resize;
    observation.controls!.engineWidth = observation.before.engineWidth;
    expect(nativeDrawingResizeComplete(observation, phase)).toBe(false);
  });
});

test('does not accept another phase, an absent request or invalid geometry', () => {
  expect(nativeDrawingResizeComplete(undefined, 'narrow')).toBe(false);
  expect(nativeDrawingResizeComplete(completed('narrow'), 'restore')).toBe(false);
  const observation = completed('narrow');
  observation.current.hostWidth = NaN;
  expect(nativeDrawingResizeComplete(observation, 'narrow')).toBe(false);
});

test.each(['narrow', 'restore'] as const)(
  'rejects the retained native %s counterfactual that the old counters accepted',
  (phase) => {
    const retained = JSON.parse(
      readFileSync(
        new URL(
          `../../docs/implementation/evidence/SPN-159/controls-${phase}.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ).result;
    const before = retained.probe.clicks.find((click: { phase: string }) => click.phase === phase)
      .observation.geometry;
    // Narrow's acceptance is the subsequent Restore click, before its expected failure.
    const after = phase === 'narrow' ? retained.probe.clicks[1].observation : retained.observation;
    const events: (DrawingGeometry & { event: string; sequence: number })[] = after.transitions.map(
      (event: DrawingGeometry & { event: string }, sequence: number) => ({ ...event, sequence }),
    );
    expect(after.resized).toBeGreaterThan(before.resized);
    expect(after.controlsCreated).toBeGreaterThan(before.controlsCreated);
    expect(
      nativeDrawingResizeComplete(
        {
          phase,
          targetWidth: phase === 'narrow' ? 1272 : 1280,
          before,
          current: after.geometry,
          resize: events.findLast((event) => event.event === 'resize'),
          controls: events.findLast((event) => event.event === 'controls'),
        },
        phase,
      ),
    ).toBe(false);
  },
);
