import { describe, it, expect } from 'vitest';
import { makeWindows } from '../src/clips/windows.js';
import { postprocess, type Candidate } from '../src/clips/postprocess.js';
import { findClips } from '../src/clips/find.js';
import { DEFAULTS } from '../src/config.js';
import type { Transcript, Word } from '../src/types.js';
import type { LlmProvider } from '../src/llm/types.js';

/** Sentences of 10 words, 1s per word → sentence ends at 10,20,30… */
function transcript(seconds: number): Transcript {
  const words: Word[] = [];
  for (let i = 0; i < seconds; i++) {
    words.push({ text: (i + 1) % 10 === 0 ? 'end.' : 'word', start: i, end: i + 1 });
  }
  return { language: 'en', duration: seconds, words };
}
const cand = (start: number, end: number, score = 50): Candidate => ({ start, end, title: 't', score, reason: 'r' });
const opts = { minSec: 30, maxSec: 60, count: 10 };

describe('makeWindows', () => {
  it('covers a 20-minute transcript with overlapping ≤360s windows', () => {
    const w = makeWindows(transcript(1200));
    expect(w[0].start).toBe(0);
    expect(w.at(-1)!.end).toBeGreaterThanOrEqual(1199);
    for (let i = 0; i < w.length; i++) {
      expect(w[i].end - w[i].start).toBeLessThanOrEqual(360);
      if (i) expect(w[i].start).toBeLessThan(w[i - 1].end);
    }
    expect(w[0].text).toMatch(/^\[00:00\]/);
  });
});

describe('postprocess', () => {
  const t = transcript(300);
  it('drops inverted and non-finite candidates', () => {
    expect(postprocess([cand(50, 40), cand(NaN, 90), cand(10, 50, NaN)], t, opts)).toEqual([]);
  });
  it('clamps to video bounds', () => {
    const [c] = postprocess([cand(-20, 40)], t, opts);
    expect(c.start).toBe(0);
    const [d] = postprocess([cand(250, 400)], t, opts);
    expect(d.end).toBeLessThanOrEqual(300);
  });
  it('extends clips shorter than min to a sentence end instead of dropping them', () => {
    const [c] = postprocess([cand(10, 30)], t, opts);
    expect(c.end - c.start).toBeGreaterThanOrEqual(30);
    expect(c.end - c.start).toBeLessThanOrEqual(60);
    expect(c.end % 10).toBe(0);
  });
  it('trims long clips to ≤ max at a sentence end', () => {
    const [c] = postprocess([cand(0, 90)], t, opts);
    expect(c.end - c.start).toBeLessThanOrEqual(60);
    expect(c.end % 10).toBe(0);
  });
  it('merges >50% overlaps keeping the higher score', () => {
    const r = postprocess([cand(0, 50, 70), cand(5, 55, 90)], t, opts);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(90);
  });
  it('clamps score and sorts desc, slices to count', () => {
    const r = postprocess([cand(0, 40, 150), cand(100, 140, 20), cand(200, 240, 60)], t, { ...opts, count: 2 });
    expect(r.map((c) => c.score)).toEqual([100, 60]);
  });
  it('keeps one whole-video clip when the video is shorter than min', () => {
    const short = transcript(20);
    const r = postprocess([cand(2, 8)], short, opts);
    expect(r).toHaveLength(1);
    expect([r[0].start, r[0].end]).toEqual([0, 20]);
  });
});

describe('findClips', () => {
  const fake = (reply: string | Error): LlmProvider => ({
    listModels: async () => [],
    completeJSON: async () => { if (reply instanceof Error) throw reply; return reply; },
  });
  it('returns post-processed candidates', async () => {
    const p = fake(JSON.stringify({ clips: [{ start: 10, end: 50, title: 'A', score: 88, reason: 'good' }] }));
    const r = await findClips(transcript(200), p, DEFAULTS, () => {});
    expect(r[0]).toMatchObject({ title: 'A', score: 88 });
  });
  it('throws the provider error when every window fails (no silent empty result)', async () => {
    await expect(findClips(transcript(200), fake(new Error('down')), DEFAULTS, () => {})).rejects.toThrow('down');
  });
  it('throws on an empty transcript', async () => {
    await expect(findClips({ language: 'en', duration: 0, words: [] }, fake('{}'), DEFAULTS, () => {}))
      .rejects.toThrow('No speech detected');
  });
});

describe('transcripts without punctuation', () => {
  const noPunct: Transcript = { language: 'en', duration: 600, words: Array.from({ length: 600 }, (_, i) => ({ text: 'w', start: i, end: i + 0.9 })) };
  it('windows still carry frequent timestamps', () => {
    const w = makeWindows(noPunct)[0];
    expect(w.text.split('\n').length).toBeGreaterThan(10);
  });
  it('postprocess keeps distinct clips (falls back to word boundaries)', () => {
    const r = postprocess([cand(200, 240, 80), cand(400, 445, 70)], noPunct, opts);
    expect(r.map((c) => Math.round(c.start))).toEqual([200, 400]);
  });
});
