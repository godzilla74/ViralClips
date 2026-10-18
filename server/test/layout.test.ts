import { describe, it, expect } from 'vitest';
import { findPanels, sampleGrayFrames, stackGeometry, validateLayout, type Gray } from '../src/layout.js';
import { makeComposite } from './helpers.js';

const near = (a: number, b: number, tol = 0.07) => Math.abs(a - b) <= tol;
const rectNear = (r: any, e: any) => near(r.x, e.x) && near(r.y, e.y) && near(r.w, e.w) && near(r.h, e.h);

/** Synthetic frames: static grey background, noisy rectangles at the given pixel boxes. */
function frames(w: number, h: number, boxes: [number, number, number, number][], n = 12): Gray[] {
  return Array.from({ length: n }, () => {
    const data = new Uint8Array(w * h).fill(30);
    for (const [x, y, bw, bh] of boxes) for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) data[j * w + i] = Math.floor(Math.random() * 255);
    return { w, h, data };
  });
}

describe('findPanels', () => {
  it('finds each moving panel as a normalized rect, largest first', () => {
    const panels = findPanels(frames(320, 180, [[10, 30, 150, 100], [240, 30, 70, 100]]));
    expect(panels).toHaveLength(2);
    expect(rectNear(panels[0], { x: 10 / 320, y: 30 / 180, w: 150 / 320, h: 100 / 180 })).toBe(true);
    expect(rectNear(panels[1], { x: 240 / 320, y: 30 / 180, w: 70 / 320, h: 100 / 180 })).toBe(true);
  });
  it('finds nothing when nothing moves', () => {
    expect(findPanels(frames(320, 180, []))).toEqual([]);
  });
  it('ignores tiny specks of motion', () => {
    expect(findPanels(frames(320, 180, [[100, 80, 8, 8]]))).toEqual([]);
  });
});

describe('findPanels with an animated background', () => {
  /** Background drifts (std ~19, like an animated OBS backdrop); the screen is full-range noise (std ~73). */
  function busyBackground(w: number, h: number, screen: [number, number, number, number], n = 12): Gray[] {
    return Array.from({ length: n }, () => {
      const data = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) data[i] = 100 + Math.floor((Math.random() - 0.5) * 66);
      const [x, y, bw, bh] = screen;
      for (let j = y; j < y + bh; j++) for (let i = x; i < x + bw; i++) data[j * w + i] = Math.floor(Math.random() * 255);
      return { w, h, data };
    });
  }
  it('still isolates the dominant moving region instead of returning the whole frame', () => {
    const panels = findPanels(busyBackground(320, 180, [10, 30, 200, 110]));
    expect(panels).toHaveLength(1);
    expect(rectNear(panels[0], { x: 10 / 320, y: 30 / 180, w: 200 / 320, h: 110 / 180 })).toBe(true);
  });
});

describe('sampleGrayFrames + findPanels on a real video', () => {
  it('detects the screen and webcam rectangles of a composite recording', async () => {
    const c = makeComposite();
    const { frames: fr, width, height } = await sampleGrayFrames(c.path, 4, 10);
    expect([width, height]).toEqual([640, 360]);
    expect(fr).toHaveLength(10);
    const panels = findPanels(fr);
    expect(panels.length).toBeGreaterThanOrEqual(2);
    expect(panels.some((p) => rectNear(p, c.screen))).toBe(true);
    expect(panels.some((p) => rectNear(p, c.webcam))).toBe(true);
  }, 60000);
});

describe('validateLayout', () => {
  it('accepts normalized rects or null, rejects the rest', () => {
    expect(validateLayout({ screen: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, face: null })).toMatchObject({ screen: { w: 0.5 }, face: null, facePanel: null });
    expect(() => validateLayout({ screen: { x: 0.8, y: 0, w: 0.5, h: 0.5 }, face: null })).toThrow(/inside/i);
    expect(() => validateLayout({ screen: { x: 0, y: 0, w: 0, h: 0.5 }, face: null })).toThrow();
    expect(() => validateLayout({ screen: { x: 'a' }, face: null } as any)).toThrow();
    expect(() => validateLayout(null as any)).toThrow();
  });
});

describe('stackGeometry', () => {
  const src = { w: 1920, h: 1080 };
  const layout = {
    screen: { x: 40 / 1920, y: 178 / 1080, w: 1300 / 1920, h: 711 / 1080 },
    face: { x: 1468 / 1920, y: 392 / 1080, w: 320 / 1920, h: 320 / 1080 },
    facePanel: { x: 1374 / 1920, y: 90 / 1080, w: 507 / 1920, h: 900 / 1080 },
  };
  const inside = (c: { x: number; y: number; w: number; h: number }) => c.x >= 0 && c.y >= 0 && c.x + c.w <= src.w && c.y + c.h <= src.h;
  it.each(['card', 'full'] as const)('screen on top, face below, nothing off-canvas (%s)', (style) => {
    const g = stackGeometry(layout, src, style)!;
    expect(g.screen && g.face).toBeTruthy();
    expect(inside(g.screen!.crop)).toBe(true);
    expect(inside(g.face!.crop)).toBe(true);
    // face crop stays inside the webcam panel
    expect(g.face!.crop.x).toBeGreaterThanOrEqual(1374 - 2);
    expect(g.face!.crop.x + g.face!.crop.w).toBeLessThanOrEqual(1374 + 507 + 2);
    // screen keeps its aspect ratio and fills the width
    expect(g.screen!.dest.w).toBe(1080);
    expect(Math.abs(g.screen!.dest.w / g.screen!.dest.h - 1300 / 711)).toBeLessThan(0.02);
    // stacked, no overlap, within the 1080x1920 canvas
    expect(g.face!.dest.y).toBeGreaterThanOrEqual(g.screen!.dest.y + g.screen!.dest.h);
    expect(g.face!.dest.y + g.face!.dest.h).toBeLessThanOrEqual(1920);
    expect(style === 'full' ? g.face!.dest.w : g.face!.dest.w).toBe(style === 'full' ? 1080 : 800);
    // the crop and dest aspect ratios agree (no stretching)
    expect(Math.abs(g.face!.crop.w / g.face!.crop.h - g.face!.dest.w / g.face!.dest.h)).toBeLessThan(0.03);
    expect(g.captionY).toBeGreaterThan(g.face!.dest.y);
    expect(g.captionY + 420).toBeLessThanOrEqual(1920);
  });
  it('without a webcam area the face crop stays on the far side of the screen', () => {
    const g = stackGeometry({ screen: layout.screen, face: layout.face, facePanel: null }, src, 'full')!;
    expect(g.face!.crop.x).toBeGreaterThanOrEqual(Math.round(1340) - 2); // screen's right edge is at x=1340
    const left = stackGeometry({ screen: { x: 0.35, y: 0.2, w: 0.6, h: 0.6 }, face: { x: 0.08, y: 0.3, w: 0.12, h: 0.2 }, facePanel: null }, src, 'full')!;
    expect(left.face!.crop.x + left.face!.crop.w).toBeLessThanOrEqual(Math.round(0.35 * 1920) + 2); // face left of screen: stop at its left edge
  });
  it('face only: a 9:16 crop centred on the face', () => {
    const g = stackGeometry({ screen: null, face: layout.face, facePanel: null }, src, 'card')!;
    expect(g.screen).toBeNull();
    expect(Math.abs(g.face!.crop.w / g.face!.crop.h - 9 / 16)).toBeLessThan(0.02);
    expect([g.face!.dest.w, g.face!.dest.h]).toEqual([1080, 1920]);
    expect(inside(g.face!.crop)).toBe(true);
  });
  it('screen only: the screen centred on the canvas', () => {
    const g = stackGeometry({ screen: layout.screen, face: null, facePanel: null }, src, 'card')!;
    expect(g.face).toBeNull();
    expect(g.screen!.dest.w).toBe(1080);
  });
  it('returns null when there is nothing to lay out', () => {
    expect(stackGeometry({ screen: null, face: null, facePanel: null }, src, 'card')).toBeNull();
  });
  it('clamps a face near the frame edge inside the source', () => {
    const edge = { screen: null, face: { x: 0.0, y: 0.0, w: 0.1, h: 0.18 }, facePanel: null };
    const g = stackGeometry(edge, src, 'card')!;
    expect(inside(g.face!.crop)).toBe(true);
  });
});
