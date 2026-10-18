import { describe, it, expect } from 'vitest';
import { medianRect, pickPanels, clampRect, moveRect, resizeRect } from './layout';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('medianRect', () => {
  it('takes the per-coordinate median, ignoring an outlier', () => {
    const m = medianRect([R(0.7, 0.3, 0.17, 0.3), R(0.71, 0.31, 0.16, 0.29), R(0.72, 0.3, 0.17, 0.3), R(0.1, 0.1, 0.05, 0.05)])!;
    expect(m.x).toBeCloseTo(0.705, 2);
    expect(m.w).toBeCloseTo(0.165, 2);
  });
  it('is null for no detections', () => expect(medianRect([])).toBeNull());
});

describe('pickPanels', () => {
  const screen = R(0.02, 0.16, 0.68, 0.66);
  const webcam = R(0.72, 0.26, 0.26, 0.65);
  const face = R(0.765, 0.36, 0.17, 0.3);
  it('webcam = the panel containing the face; screen = the biggest other panel', () => {
    expect(pickPanels([screen, webcam], face)).toEqual({ screen, facePanel: webcam });
    expect(pickPanels([webcam, screen], face)).toEqual({ screen, facePanel: webcam });
  });
  it('without a face the biggest sizeable panel is the screen', () => {
    expect(pickPanels([screen, webcam], null)).toEqual({ screen, facePanel: null });
  });
  it('a face with no separate screen panel gives no screen (talking head only)', () => {
    expect(pickPanels([webcam], face)).toEqual({ screen: null, facePanel: webcam });
    expect(pickPanels([], face)).toEqual({ screen: null, facePanel: null });
  });
  it('ignores panels that are too small to be a screen share', () => {
    expect(pickPanels([R(0.1, 0.1, 0.05, 0.05)], null).screen).toBeNull();
  });
});

describe('rect editing', () => {
  it('clampRect keeps a rect inside the frame with a minimum size', () => {
    expect(clampRect(R(-0.1, 0.9, 0.5, 0.5))).toEqual(R(0, 0.5, 0.5, 0.5));
    const tiny = clampRect(R(0.5, 0.5, 0.001, 0.001));
    expect(tiny.w).toBeGreaterThanOrEqual(0.04);
  });
  it('moveRect never leaves the frame', () => {
    expect(moveRect(R(0.5, 0.5, 0.4, 0.4), 0.5, -0.9)).toEqual(R(0.6, 0, 0.4, 0.4));
  });
  it('resizeRect moves one corner and keeps the opposite one fixed', () => {
    const r = resizeRect(R(0.2, 0.2, 0.4, 0.4), 'se', 0.1, 0.1);
    expect(r).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
    const nw = resizeRect(R(0.2, 0.2, 0.4, 0.4), 'nw', 0.1, 0.05);
    expect(nw.x).toBeCloseTo(0.3); expect(nw.y).toBeCloseTo(0.25);
    expect(nw.x + nw.w).toBeCloseTo(0.6); expect(nw.y + nw.h).toBeCloseTo(0.6);
  });
  it('resizeRect refuses to invert or collapse', () => {
    const r = resizeRect(R(0.2, 0.2, 0.4, 0.4), 'se', -0.9, -0.9);
    expect(r.w).toBeGreaterThanOrEqual(0.04);
    expect(r.h).toBeGreaterThanOrEqual(0.04);
  });
});
