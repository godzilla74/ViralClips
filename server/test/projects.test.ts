import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { makeVideo } from './helpers.js';

const mk = () => buildApp({ db: openDb(':memory:'), dataDir: makeVideo().dir });

describe('project routes', () => {
  it('creates from a local path with spaces, lists, streams a range', async () => {
    const app = mk();
    const v = makeVideo();
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { path: v.path } });
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.name).toContain('vid');
    expect((await app.inject({ url: '/api/projects' })).json()).toHaveLength(1);
    const r = await app.inject({ url: `/api/projects/${p.id}/video`, headers: { range: 'bytes=0-99' } });
    expect(r.statusCode).toBe(206);
    expect(r.rawPayload.length).toBe(100);
  });
  it('rejects missing file and silent video', async () => {
    const app = mk();
    const a = await app.inject({ method: 'POST', url: '/api/projects', payload: { path: '/nope/x.mp4' } });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({ method: 'POST', url: '/api/projects', payload: { path: makeVideo({ audio: false }).path } });
    expect(b.statusCode).toBe(400);
    expect(b.json().error).toMatch(/No audio track/);
  });
});
