import { execFile } from 'node:child_process';
import { probe } from './media.js';
import type { Layout, Rect, Settings } from './types.js';

export interface Gray { w: number; h: number; data: Uint8Array }
export interface Box { x: number; y: number; w: number; h: number }
export interface Placement { crop: Box; dest: Box }
export interface Geometry { screen: Placement | null; face: Placement | null; captionY: number }

const OUT_W = 1080;
const OUT_H = 1920;
const CAPTION_H = 420;
const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// ---------- panel discovery (screen share / webcam) from frame-to-frame change ----------

/**
 * Finds the rectangles whose content changes over time (a screen share, a webcam) as normalized rects, largest first.
 * Static backgrounds, logos and borders don't change, so they drop out.
 */
export function findPanels(frames: Gray[], o: { cell?: number; threshold?: number } = {}): Rect[] {
  if (frames.length < 2) return [];
  const { w, h } = frames[0];
  const cell = o.cell ?? 4;
  const threshold = o.threshold ?? 10;
  const n = frames.length;
  const sum = new Float64Array(w * h);
  const sq = new Float64Array(w * h);
  for (const f of frames) for (let i = 0; i < w * h; i++) { const v = f.data[i]; sum[i] += v; sq[i] += v * v; }

  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  let grid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let acc = 0, cnt = 0;
    for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++) for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
      const i = y * w + x, mean = sum[i] / n;
      acc += Math.sqrt(Math.max(0, sq[i] / n - mean * mean)); cnt++;
    }
    grid[gy * gw + gx] = acc / cnt >= threshold ? 1 : 0;
  }
  grid = erode(dilate(grid, gw, gh), gw, gh); // close small holes

  const seen = new Uint8Array(gw * gh);
  const out: { r: Rect; cells: number }[] = [];
  const minCells = Math.max(12, Math.round(gw * gh * 0.015));
  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || seen[start]) continue;
    const queue = [start]; seen[start] = 1;
    let minX = gw, minY = gh, maxX = 0, maxY = 0, cells = 0;
    while (queue.length) {
      const c = queue.pop()!, cx = c % gw, cy = Math.floor(c / gw);
      cells++; minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx;
        if (grid[ni] && !seen[ni]) { seen[ni] = 1; queue.push(ni); }
      }
    }
    if (cells >= minCells && maxX - minX >= 3 && maxY - minY >= 3) {
      out.push({
        cells,
        r: {
          x: (minX * cell) / w, y: (minY * cell) / h,
          w: Math.min(1, ((maxX - minX + 1) * cell) / w), h: Math.min(1, ((maxY - minY + 1) * cell) / h),
        },
      });
    }
  }
  return out.sort((a, b) => b.cells - a.cells).slice(0, 4).map((c) => c.r);
}

function dilate(g: Uint8Array, gw: number, gh: number) {
  const o = new Uint8Array(g.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && g[ny * gw + nx]) { v = 1; break; }
    }
    o[y * gw + x] = v;
  }
  return o;
}
function erode(g: Uint8Array, gw: number, gh: number) {
  const o = new Uint8Array(g.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v = 1;
    for (let dy = -1; dy <= 1 && v; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && !g[ny * gw + nx]) { v = 0; break; }
    }
    o[y * gw + x] = v;
  }
  return o;
}

/** Evenly spaced small grayscale frames (raw pixels) for change detection. */
export async function sampleGrayFrames(videoPath: string, duration: number, count = 24, width = 320) {
  const info = await probe(videoPath);
  const height = even((width * info.height) / info.width);
  const times = Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
  const grab = (t: number) => new Promise<Gray>((resolve, reject) =>
    execFile('ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', videoPath, '-frames:v', '1',
      '-vf', `scale=${width}:${height}`, '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'],
    { encoding: 'buffer', maxBuffer: width * height * 4 }, (err, stdout) => {
      if (err || stdout.length < width * height) return reject(new Error('Could not read video frames'));
      resolve({ w: width, h: height, data: new Uint8Array(stdout.subarray(0, width * height)) });
    }));
  const frames: Gray[] = [];
  for (let i = 0; i < times.length; i += 4) frames.push(...(await Promise.all(times.slice(i, i + 4).map(grab))));
  return { frames, width: info.width, height: info.height };
}

// ---------- layout validation ----------

function rect(v: unknown, name: string): Rect | null {
  if (v == null) return null;
  const r = v as Record<string, unknown>;
  const [x, y, w, h] = ['x', 'y', 'w', 'h'].map((k) => r?.[k]);
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error(`${name} must have numeric x, y, w, h`);
  const [rx, ry, rw, rh] = [x, y, w, h] as number[];
  if (rw <= 0.01 || rh <= 0.01) throw new Error(`${name} is too small`);
  if (rx < 0 || ry < 0 || rx + rw > 1.001 || ry + rh > 1.001) throw new Error(`${name} must be inside the video frame`);
  return { x: rx, y: ry, w: Math.min(rw, 1 - rx), h: Math.min(rh, 1 - ry) };
}

export function validateLayout(input: unknown): Layout {
  if (!input || typeof input !== 'object') throw new Error('Layout must be an object');
  const l = input as Record<string, unknown>;
  return { screen: rect(l.screen, 'screen'), face: rect(l.face, 'face'), facePanel: rect(l.facePanel, 'facePanel') };
}

// ---------- geometry of the 1080x1920 "stack" layout ----------

const toPx = (r: Rect, src: { w: number; h: number }): Box => ({
  x: Math.round(r.x * src.w), y: Math.round(r.y * src.h), w: Math.round(r.w * src.w), h: Math.round(r.h * src.h),
});

/** Crop `aspect` (w/h) around a centre, as large as `want` allows, kept inside `bounds`. */
function cropAround(cx: number, cy: number, wantW: number, aspect: number, bounds: Box): Box {
  let w = Math.min(bounds.w, wantW);
  let h = w / aspect;
  if (h > bounds.h) { h = bounds.h; w = h * aspect; }
  w = even(w); h = even(h);
  return {
    x: Math.round(clamp(cx - w / 2, bounds.x, bounds.x + bounds.w - w)),
    y: Math.round(clamp(cy - h / 2, bounds.y, bounds.y + bounds.h - h)),
    w, h,
  };
}

export function stackGeometry(layout: Layout, src: { w: number; h: number }, style: Settings['faceStyle']): Geometry | null {
  const whole: Box = { x: 0, y: 0, w: src.w, h: src.h };
  const screen = layout.screen ? toPx(layout.screen, src) : null;
  const face = layout.face ? toPx(layout.face, src) : null;
  const panel = layout.facePanel ? toPx(layout.facePanel, src) : null;
  if (!screen && !face) return null;

  if (face && !screen) { // talking head only: a 9:16 crop centred on the face
    const crop = cropAround(face.x + face.w / 2, face.y + face.h / 2, src.h * (9 / 16), 9 / 16, whole);
    return { screen: null, face: { crop, dest: { x: 0, y: 0, w: OUT_W, h: OUT_H } }, captionY: Math.round(OUT_H * 0.58) };
  }

  // screen dest: full width, aspect kept (capped so a tall region can't take the whole canvas)
  const sCrop = cropAround(screen!.x + screen!.w / 2, screen!.y + screen!.h / 2, screen!.w, screen!.w / screen!.h, screen!);
  let sW = OUT_W, sH = even((OUT_W * sCrop.h) / sCrop.w);
  if (sH > 1000) { sH = 1000; sW = even((sH * sCrop.w) / sCrop.h); }

  if (!face) {
    const y = Math.round((OUT_H - sH) / 2);
    return { screen: { crop: sCrop, dest: { x: Math.round((OUT_W - sW) / 2), y, w: sW, h: sH } }, face: null,
      captionY: clamp(y + sH - 40, 0, OUT_H - CAPTION_H) };
  }

  const GAP = 40, TOP_MIN = 40, CAPTION_ZONE = 340;
  const maxFaceH = Math.max(560, OUT_H - CAPTION_ZONE - TOP_MIN - sH - GAP);
  const fW = style === 'full' ? OUT_W : even(Math.min(800, maxFaceH));
  const fH = style === 'full' ? even(Math.min(960, maxFaceH)) : fW;
  const content = sH + GAP + fH;
  const top = Math.max(TOP_MIN, Math.round((OUT_H - CAPTION_ZONE - content) / 2));
  const bounds = panel ?? whole;
  const fCrop = cropAround(face.x + face.w / 2, face.y + face.h / 2, face.w * 1.9, fW / fH, bounds);
  const faceY = top + sH + GAP;
  return {
    screen: { crop: sCrop, dest: { x: Math.round((OUT_W - sW) / 2), y: top, w: sW, h: sH } },
    face: { crop: fCrop, dest: { x: Math.round((OUT_W - fW) / 2), y: faceY, w: fW, h: fH } },
    captionY: clamp(faceY + fH - 40, 0, OUT_H - CAPTION_H),
  };
}
