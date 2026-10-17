import { describe, it, expect } from 'vitest';
import { excerpt } from './excerpt';

const words = Array.from({ length: 100 }, (_, i) => ({ text: `w${i}`, start: i, end: i + 0.9 }));

describe('excerpt', () => {
  it('returns opening and closing words of the clip range only', () => {
    const e = excerpt(words, 10, 50, 3, 2);
    expect(e.head).toBe('w10 w11 w12');
    expect(e.tail).toBe('w48 w49');
    expect(e.truncated).toBe(true);
  });
  it('returns the whole text with no tail when the clip is short', () => {
    const e = excerpt(words, 10, 13, 5, 3);
    expect(e.head).toBe('w10 w11 w12');
    expect(e.tail).toBe('');
    expect(e.truncated).toBe(false);
  });
  it('handles a range with no words', () => {
    expect(excerpt(words, 500, 600)).toEqual({ head: '', tail: '', truncated: false });
  });
});
