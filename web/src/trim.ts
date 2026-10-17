/** Clamp a trim range to the video and enforce a minimum length. */
export function clampTrim(start: number, end: number, duration: number, minSec = 5) {
  const s = Math.min(Math.max(start, 0), Math.max(0, duration - minSec));
  const e = Math.min(duration, Math.max(end, s + minSec));
  return { start: s, end: e };
}
