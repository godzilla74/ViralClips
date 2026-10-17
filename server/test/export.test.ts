import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { exportClip } from '../src/export.js';
import { probe } from '../src/media.js';
import { DEFAULTS } from '../src/config.js';
import { makeVideo } from './helpers.js';
import type { Clip, Word } from '../src/types.js';

const words: Word[] = Array.from({ length: 12 }, (_, i) => ({ text: i === 3 ? 'it\'s {odd}\\' : 'word', start: 2 + i * 0.4, end: 2.35 + i * 0.4 }));
const clip: Clip = { id: 'abcdef123456', projectId: 'p', start: 2, end: 7, title: 'My "Great" clip: é', score: 90, reason: '', selected: true };

describe('exportClip', () => {
  for (const framing of ['crop', 'blur', 'original'] as const) {
    it(`exports 1080x1920 with captions (${framing})`, async () => {
      const v = makeVideo({ seconds: 10 });
      const out = join(v.dir, 'out dir');
      const path = await exportClip({
        videoPath: v.path, clip, words, outDir: out, onProgress: () => {},
        settings: { ...DEFAULTS, framing, captions: true },
      });
      const info = await probe(path);
      expect([info.width, info.height]).toEqual([1080, 1920]);
      expect(Math.abs(info.duration - 5)).toBeLessThan(0.35);
      expect(info.hasAudio).toBe(true);
      rmSync(v.dir, { recursive: true, force: true });
    }, 60000);
  }
  it('exports without captions', async () => {
    const v = makeVideo({ seconds: 10 });
    const path = await exportClip({
      videoPath: v.path, clip, words: [], outDir: join(v.dir, 'o'), onProgress: () => {},
      settings: { ...DEFAULTS, captions: false },
    });
    expect((await probe(path)).height).toBe(1920);
  }, 60000);
  it('leaves no partial file behind when ffmpeg fails', async () => {
    const out = join(makeVideo({ seconds: 2 }).dir, 'o');
    await expect(exportClip({
      videoPath: '/definitely/not/here.mp4', clip, words: [], outDir: out, onProgress: () => {},
      settings: { ...DEFAULTS, captions: false },
    })).rejects.toThrow();
    expect(!existsSync(out) || readdirSync(out).length === 0).toBe(true);
  });
  it('does not expose the mp4 until it is complete', async () => {
    const v = makeVideo({ seconds: 4 });
    const out = join(v.dir, 'o');
    let sawPartialMp4 = false;
    const path = await exportClip({
      videoPath: v.path, clip: { ...clip, start: 0, end: 3 }, words: [], outDir: out,
      onProgress: (pct) => { if (pct < 100 && existsSync(out) && readdirSync(out).some((f) => f.endsWith('.mp4'))) sawPartialMp4 = true; },
      settings: { ...DEFAULTS, captions: false },
    });
    expect(sawPartialMp4).toBe(false);
    expect(path.endsWith('.mp4') && existsSync(path)).toBe(true);
  }, 60000);
});
