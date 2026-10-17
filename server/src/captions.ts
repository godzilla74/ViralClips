import { createCanvas } from '@napi-rs/canvas';
import type { Settings, Word } from './types.js';

export interface CaptionSegment { start: number; end: number; words: string[]; active: number }
type Style = Settings['captionStyle'];

export const CAPTION_W = 1080;
export const CAPTION_H = 420;
const MAX_WORDS = 4;
const MAX_SPAN = 2.5;

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Groups words into short lines and returns time-ranged segments (clip-relative seconds). */
export function buildCaptionSegments(words: Word[], clipStart: number, style: Style): CaptionSegment[] {
  const rel = words
    .map((w) => ({ text: clean(w.text), start: Math.max(0, w.start - clipStart), end: Math.max(0, w.end - clipStart) }))
    .filter((w) => w.text);
  const lines: typeof rel[] = [];
  let cur: typeof rel = [];
  for (const w of rel) {
    if (cur.length && (cur.length >= MAX_WORDS || w.end - cur[0].start > MAX_SPAN)) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);

  return lines.flatMap((line) => {
    const texts = line.map((w) => w.text);
    if (style !== 'karaoke') return [{ start: line[0].start, end: line.at(-1)!.end, words: texts, active: -1 }];
    return line.map((w, i) => ({ start: w.start, end: line[i + 1]?.start ?? w.end, words: texts, active: i }));
  });
}

const STYLES: Record<Style, { size: number; stroke: number; fill: string; active: string }> = {
  bold: { size: 92, stroke: 16, fill: '#FFFFFF', active: '#FFFFFF' },
  clean: { size: 64, stroke: 7, fill: '#FFFFFF', active: '#FFFFFF' },
  karaoke: { size: 84, stroke: 14, fill: '#FFFFFF', active: '#FFD400' },
};

/** Draws one caption state as a transparent 1080x420 PNG. */
export function renderSegmentPng(seg: Pick<CaptionSegment, 'words' | 'active'>, style: Style): Buffer {
  const st = STYLES[style];
  const canvas = createCanvas(CAPTION_W, CAPTION_H);
  const ctx = canvas.getContext('2d');
  ctx.font = `800 ${st.size}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const space = ctx.measureText(' ').width;
  const maxW = CAPTION_W - 120;

  // greedy wrap into lines of {word index, x offset}
  const lines: { idx: number[]; width: number }[] = [{ idx: [], width: 0 }];
  seg.words.forEach((w, i) => {
    const wd = ctx.measureText(w).width;
    let l = lines.at(-1)!;
    if (l.idx.length && l.width + space + wd > maxW) lines.push((l = { idx: [], width: 0 }));
    l.width += (l.idx.length ? space : 0) + wd;
    l.idx.push(i);
  });

  const lh = st.size * 1.2;
  let y = CAPTION_H / 2 - ((lines.length - 1) * lh) / 2;
  for (const l of lines) {
    let x = (CAPTION_W - l.width) / 2;
    for (const i of l.idx) {
      const w = seg.words[i];
      ctx.lineWidth = st.stroke;
      ctx.strokeStyle = '#000000';
      ctx.strokeText(w, x, y);
      ctx.fillStyle = i === seg.active ? st.active : st.fill;
      ctx.fillText(w, x, y);
      x += ctx.measureText(w).width + space;
    }
    y += lh;
  }
  return canvas.toBuffer('image/png');
}

export const blankPng = (): Buffer => createCanvas(CAPTION_W, CAPTION_H).toBuffer('image/png');
