import type { Transcript, Word } from '../types.js';

export interface Window { start: number; end: number; text: string }

const stamp = (s: number) => {
  const m = Math.floor(s / 60);
  return `[${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}]`;
};

function render(words: Word[]): string {
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  words.forEach((w, i) => {
    if (!line.length) lineStart = w.start;
    line.push(w.text);
    const next = words[i + 1];
    const sentence = /[.?!]$/.test(w.text) && w.end - lineStart >= 8;
    const pause = !!next && next.start - w.end >= 0.7 && w.end - lineStart >= 4;
    const long = w.end - lineStart >= 10; // keeps timestamps frequent when punctuation is missing
    if (sentence || pause || long) {
      lines.push(`${stamp(lineStart)} ${line.join(' ')}`);
      line = [];
    }
  });
  if (line.length) lines.push(`${stamp(lineStart)} ${line.join(' ')}`);
  return lines.join('\n');
}

export function makeWindows(t: Transcript, sizeSec = 360, overlapSec = 60): Window[] {
  const out: Window[] = [];
  const total = t.words.at(-1)?.end ?? t.duration;
  for (let start = 0; ; start += sizeSec - overlapSec) {
    const end = Math.min(start + sizeSec, total);
    const words = t.words.filter((w) => w.start >= start && w.start < end);
    if (words.length) out.push({ start, end, text: render(words) });
    if (end >= total) break;
  }
  return out;
}
