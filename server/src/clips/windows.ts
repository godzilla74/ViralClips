import type { Transcript, Word } from '../types.js';

export interface Line { id: number; start: number; end: number; text: string }
export interface Window { start: number; end: number; text: string; lines: Line[] }

/** Splits the transcript into numbered lines (~8-12 s) with exact word-derived times. */
export function makeLines(t: Transcript): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({ id: lines.length, start: cur[0].start, end: cur.at(-1)!.end, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  t.words.forEach((w, i) => {
    cur.push(w);
    const next = t.words[i + 1];
    const lineStart = cur[0].start;
    const sentence = /[.?!]$/.test(w.text) && w.end - lineStart >= 8;
    const pause = !!next && next.start - w.end >= 0.7 && w.end - lineStart >= 4;
    const long = w.end - lineStart >= 10; // keeps lines short when punctuation is missing
    if (sentence || pause || long) flush();
  });
  flush();
  return lines;
}

/** Overlapping windows over the numbered lines; text shows `[L<id>|<seconds>s] ...` so a model can cite lines instead of times. */
export function makeWindows(t: Transcript, sizeSec = 360, overlapSec = 60): Window[] {
  const lines = makeLines(t);
  const total = t.words.at(-1)?.end ?? t.duration;
  const out: Window[] = [];
  for (let start = 0; ; start += sizeSec - overlapSec) {
    const end = Math.min(start + sizeSec, total);
    const inWin = lines.filter((l) => l.start >= start && l.start < end);
    if (inWin.length) {
      out.push({
        start, end, lines: inWin,
        text: inWin.map((l) => `[L${l.id}|${Math.max(1, Math.round(l.end - l.start))}s] ${l.text}`).join('\n'),
      });
    }
    if (end >= total) break;
  }
  return out;
}
