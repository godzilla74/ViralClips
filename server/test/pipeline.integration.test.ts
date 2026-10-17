import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { probe } from '../src/media.js';
import { makeVideo } from './helpers.js';
import { join } from 'node:path';

const words = Array.from({ length: 200 }, (_, i) => ({ text: (i + 1) % 10 === 0 ? 'end.' : 'hello', start: i * 0.2, end: i * 0.2 + 0.18 }));
const reply = JSON.stringify({ clips: [
  { start_line: 0, end_line: 3, title: 'First', score: 95, reason: 'a' },
  { start_line: 90, end_line: 93, title: 'Second', score: 70, reason: 'b' },
] });

describe('pipeline', () => {
  it('analyze → edit → export only selected clips as 1080x1920', async () => {
    const v = makeVideo({ seconds: 40, w: 640, h: 360 });
    const app = buildApp({
      db: openDb(':memory:'), dataDir: v.dir,
      transcribe: async () => ({ language: 'en', duration: 40, words }),
      provider: () => ({ listModels: async () => [], completeJSON: async () => reply }),
    });
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { path: v.path } })).json();
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/analyze` });
    await app.jobs.whenIdle(p.id);
    const clips = (await app.inject({ url: `/api/projects/${p.id}/clips` })).json();
    expect(clips.map((c: any) => c.title)).toEqual(['First']); // unknown line ids are dropped
    await app.inject({ method: 'PATCH', url: `/api/clips/${clips[0].id}`, payload: { start: 2, end: 36 } });
    const ex = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: { settings: { framing: 'blur', captions: true } } });
    expect(ex.statusCode).toBe(202);
    await app.jobs.whenIdle(p.id);
    const files = (await app.inject({ url: `/api/projects/${p.id}/exports` })).json();
    expect(files).toHaveLength(1);
    const dl = await app.inject({ url: files[0].url });
    expect(dl.statusCode).toBe(200);
    const info = await probe(join(v.dir, 'exports', p.id, files[0].file));
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(Math.abs(info.duration - 34)).toBeLessThan(0.5);
  }, 90000);

  it('rejects export with nothing selected and path traversal downloads', async () => {
    const v = makeVideo({ seconds: 5 });
    const app = buildApp({ db: openDb(':memory:'), dataDir: v.dir });
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { path: v.path } })).json();
    expect((await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ url: `/api/exports/${p.id}/..%2F..%2Fconfig.json` })).statusCode).toBe(404);
  });
});
