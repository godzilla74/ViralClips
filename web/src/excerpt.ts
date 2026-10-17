import type { Word } from './api';

/** Opening and closing words spoken inside [start, end], so a clip's title can be checked against what is actually said. */
export function excerpt(words: Word[], start: number, end: number, head = 16, tail = 6) {
  const inside = words.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05);
  if (inside.length <= head + tail) return { head: inside.map((w) => w.text).join(' '), tail: '', truncated: false };
  return {
    head: inside.slice(0, head).map((w) => w.text).join(' '),
    tail: inside.slice(-tail).map((w) => w.text).join(' '),
    truncated: true,
  };
}
