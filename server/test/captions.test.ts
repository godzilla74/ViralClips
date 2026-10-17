import { describe, it, expect } from 'vitest';
import { GlobalFonts } from '@napi-rs/canvas';
import { buildCaptionSegments, renderSegmentPng, CAPTION_FONT } from '../src/captions.js';
import type { Word } from '../src/types.js';

const words = (texts: string[], t0 = 10): Word[] => texts.map((text, i) => ({ text, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.35 }));

describe('buildCaptionSegments', () => {
  const w = words(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  it('shifts times to clip-relative and groups lines of ≤4 words', () => {
    const segs = buildCaptionSegments(w, 10, 'clean');
    expect(segs[0].start).toBeCloseTo(0);
    expect(segs.map((s) => s.words.length)).toEqual([4, 3]);
    expect(segs.every((s) => s.active === -1)).toBe(true);
  });
  it('karaoke yields one segment per word, highlighting each in order, contiguous within a line', () => {
    const segs = buildCaptionSegments(w, 10, 'karaoke');
    expect(segs).toHaveLength(7);
    expect(segs.slice(0, 4).map((s) => s.active)).toEqual([0, 1, 2, 3]);
    expect(segs[0].end).toBeCloseTo(segs[1].start);
  });
  it('keeps special characters raw (no markup injection) and flattens newlines', () => {
    const segs = buildCaptionSegments(words(['a{b}\\c', 'line\nbreak']), 10, 'clean');
    expect(segs[0].words).toEqual(['a{b}\\c', 'line break']);
  });
  it('splits a line on long pauses (>2.5s span)', () => {
    const slow: Word[] = [{ text: 'x', start: 0, end: 0.3 }, { text: 'y', start: 3, end: 3.3 }];
    expect(buildCaptionSegments(slow, 0, 'clean')).toHaveLength(2);
  });
  it('returns nothing for no words', () => {
    expect(buildCaptionSegments([], 0, 'bold')).toEqual([]);
  });
});

describe('renderSegmentPng', () => {
  it('renders a 1080-wide PNG even with odd characters', () => {
    const buf = renderSegmentPng({ start: 0, end: 1, words: ['a{b}\\c', 'é', '😀', 'longerwordhere'], active: 1 }, 'karaoke');
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(1080);
  });
});

describe('bundled caption font', () => {
  it('registers the bundled font so captions look the same on every OS', () => {
    expect(CAPTION_FONT).toBe('ViralClipsCaption');
    expect(GlobalFonts.has(CAPTION_FONT)).toBe(true);
  });
});
