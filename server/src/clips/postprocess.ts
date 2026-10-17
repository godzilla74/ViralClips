import type { Transcript } from '../types.js';

export interface Candidate { start: number; end: number; title: string; score: number; reason: string }
export interface PostOpts { minSec: number; maxSec: number; count: number }

const nearest = (xs: number[], v: number) => xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), xs[0]);

/** Sentence boundaries: terminal punctuation, or a pause ≥0.7s when punctuation is missing. */
function boundaries(t: Transcript) {
  const starts = [0];
  const ends: number[] = [];
  t.words.forEach((w, i) => {
    const next = t.words[i + 1];
    if (/[.?!]$/.test(w.text) || (next && next.start - w.end >= 0.7)) {
      ends.push(w.end);
      if (next) starts.push(next.start);
    }
  });
  const total = t.words.at(-1)?.end ?? t.duration;
  if (ends.at(-1) !== total) ends.push(total);
  return { starts, ends };
}

export function postprocess(cands: Candidate[], t: Transcript, o: PostOpts): Candidate[] {
  const total = t.words.at(-1)?.end ?? t.duration;
  const { starts, ends } = boundaries(t);
  const valid = cands
    .filter((c) => [c.start, c.end, c.score].every(Number.isFinite) && c.start < c.end)
    .map((c) => ({ ...c, start: Math.max(0, c.start), end: Math.min(total, c.end), score: Math.min(100, Math.max(0, c.score)) }))
    .filter((c) => c.end > c.start);

  if (total < o.minSec) {
    const best = [...valid].sort((a, b) => b.score - a.score)[0];
    return best ? [{ ...best, start: 0, end: total }] : [];
  }

  const snapped: Candidate[] = [];
  for (const c of valid) {
    const start = nearest(starts, c.start);
    let end = nearest(ends, c.end);
    if (end - start > o.maxSec) {
      const fit = ends.filter((e) => e > start && e - start <= o.maxSec).at(-1);
      end = fit ?? start + o.maxSec;
    }
    if (end - start >= o.minSec) snapped.push({ ...c, start, end });
  }

  const kept: Candidate[] = [];
  for (const c of snapped.sort((a, b) => b.score - a.score)) {
    const dup = kept.some((k) => {
      const overlap = Math.min(k.end, c.end) - Math.max(k.start, c.start);
      return overlap > 0.5 * Math.min(k.end - k.start, c.end - c.start);
    });
    if (!dup) kept.push(c);
  }
  return kept.slice(0, o.count);
}
