import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { probe, extractAudio } from '../src/media.js';
import { makeVideo } from './helpers.js';

describe('media', () => {
  it('probes duration/audio and extracts wav (path with spaces/unicode)', async () => {
    const v = makeVideo({ seconds: 3 });
    const info = await probe(v.path);
    expect(info.duration).toBeCloseTo(3, 0);
    expect(info.hasAudio).toBe(true);
    expect([info.width, info.height]).toEqual([1920, 1080]);
    const wav = join(v.dir, 'a.wav');
    await extractAudio(v.path, wav);
    expect(existsSync(wav) && statSync(wav).size > 1000).toBe(true);
  });
  it('detects missing audio', async () => {
    const v = makeVideo({ audio: false });
    expect((await probe(v.path)).hasAudio).toBe(false);
  });
});
