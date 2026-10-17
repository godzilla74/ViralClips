import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWhisperJson } from '../src/transcribe.js';

describe('parseWhisperJson', () => {
  it('merges sub-word tokens, drops specials, converts ms to seconds', () => {
    const raw = JSON.parse(readFileSync(new URL('./fixtures/whisper-sample.json', import.meta.url), 'utf8'));
    const t = parseWhisperJson(raw);
    expect(t.language).toBe('en');
    expect(t.words).toEqual([
      { text: 'Hello', start: 0.1, end: 0.7 },
      { text: 'world.', start: 0.8, end: 1.3 },
    ]);
    expect(t.duration).toBeCloseTo(1.3);
  });
  it('handles empty transcription', () => {
    expect(parseWhisperJson({ transcription: [] }).words).toEqual([]);
  });
});
