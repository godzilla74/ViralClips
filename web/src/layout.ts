/** Rect in normalized (0..1) source-frame coordinates. */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Layout { screen: Rect | null; face: Rect | null; facePanel: Rect | null }

const MIN = 0.04;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const area = (r: Rect) => r.w * r.h;
const hasCenterOf = (panel: Rect, r: Rect) => {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return cx >= panel.x && cx <= panel.x + panel.w && cy >= panel.y && cy <= panel.y + panel.h;
};

/** Per-coordinate median of detections: robust to a frame where the detector latched onto something else. */
export function medianRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  return { x: median(rects.map((r) => r.x)), y: median(rects.map((r) => r.y)), w: median(rects.map((r) => r.w)), h: median(rects.map((r) => r.h)) };
}

/** From the moving panels + the detected face: the webcam panel holds the face, the screen is the biggest other panel. */
export function pickPanels(panels: Rect[], face: Rect | null): { screen: Rect | null; facePanel: Rect | null } {
  const facePanel = face ? [...panels].filter((p) => hasCenterOf(p, face)).sort((a, b) => area(a) - area(b))[0] ?? null : null;
  const screen = [...panels].filter((p) => p !== facePanel && area(p) >= 0.08 && p.w >= 0.2).sort((a, b) => area(b) - area(a))[0] ?? null;
  return { screen, facePanel };
}

export function clampRect(r: Rect): Rect {
  const w = Math.min(1, Math.max(MIN, r.w)), h = Math.min(1, Math.max(MIN, r.h));
  return { x: Math.min(Math.max(0, r.x), 1 - w), y: Math.min(Math.max(0, r.y), 1 - h), w, h };
}

export const moveRect = (r: Rect, dx: number, dy: number): Rect => clampRect({ ...r, x: r.x + dx, y: r.y + dy });

/** Drag one corner; the opposite corner stays put. */
export function resizeRect(r: Rect, corner: 'nw' | 'ne' | 'sw' | 'se', dx: number, dy: number): Rect {
  let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
  if (corner.includes('w')) x1 = Math.min(x1 + dx, x2 - MIN); else x2 = Math.max(x2 + dx, x1 + MIN);
  if (corner.includes('n')) y1 = Math.min(y1 + dy, y2 - MIN); else y2 = Math.max(y2 + dy, y1 + MIN);
  return clampRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
}
