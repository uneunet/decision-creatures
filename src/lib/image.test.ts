import { describe, expect, test } from 'bun:test';
import { clampCropOffset, computeCropMetrics } from './image';

describe('crop geometry metrics & clamping', () => {
  test('allows vertical pan only (zero horizontal overflow) for portrait photo at zoom=1', () => {
    const m = computeCropMetrics(1000, 2000, 280, 210, 1);
    expect(m.drawnW).toBeCloseTo(280, 5);
    expect(m.drawnH).toBeCloseTo(560, 5);
    expect(m.maxX).toBe(0);
    expect(m.maxY).toBeCloseTo(175, 5);

    expect(clampCropOffset(40, 220, m.maxX, m.maxY)).toEqual({ x: 0, y: 175 });
    expect(clampCropOffset(-40, -220, m.maxX, m.maxY)).toEqual({ x: 0, y: -175 });
  });

  test('allows horizontal pan only (zero vertical overflow) for wide landscape photo at zoom=1', () => {
    const m = computeCropMetrics(2000, 1000, 280, 210, 1);
    expect(m.drawnW).toBeCloseTo(420, 5);
    expect(m.drawnH).toBeCloseTo(210, 5);
    expect(m.maxX).toBeCloseTo(70, 5);
    expect(m.maxY).toBe(0);
  });

  test('clamps pan offset back into bounds when zooming out', () => {
    const zoomedIn = computeCropMetrics(1000, 1000, 200, 200, 2.0);
    expect(zoomedIn.maxX).toBe(100);
    expect(zoomedIn.maxY).toBe(100);

    const zoomedOut = computeCropMetrics(1000, 1000, 200, 200, 1.0);
    expect(zoomedOut.maxX).toBe(0);
    expect(zoomedOut.maxY).toBe(0);
    expect(clampCropOffset(90, -80, zoomedOut.maxX, zoomedOut.maxY)).toEqual({ x: 0, y: 0 });
  });
});
