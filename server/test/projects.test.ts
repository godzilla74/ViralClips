import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { makeVideo } from './helpers.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  it('rejects cross-origin and non-local Host requests', async () => {
    const app = mk();
    const evil = await app.inject({ method: 'POST', url: '/api/projects', headers: { origin: 'https://evil.example' }, payload: { path: '/x' } });
    expect(evil.statusCode).toBe(403);
    const rebind = await app.inject({ url: '/api/projects', headers: { host: 'evil.example:4777' } });
    expect(rebind.statusCode).toBe(403);
    const ok = await app.inject({ url: '/api/projects', headers: { origin: 'http://localhost:5173', host: 'localhost:5173' } });
    expect(ok.statusCode).toBe(200);
  });
  it('deleting a project removes its audio, exports and uploaded copy', async () => {
    const v = makeVideo();
    const app = buildApp({ db: openDb(':memory:'), dataDir: v.dir });
    const up = join(v.dir, 'uploads'); mkdirSync(up, { recursive: true });
    const copy = join(up, 'copy.mp4'); writeFileSync(copy, 'x');
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { path: v.path } })).json();
    mkdirSync(join(v.dir, 'audio'), { recursive: true }); writeFileSync(join(v.dir, 'audio', `${p.id}.wav`), 'x');
    mkdirSync(join(v.dir, 'exports', p.id), { recursive: true }); writeFileSync(join(v.dir, 'exports', p.id, 'a.mp4'), 'x');
    await app.inject({ method: 'DELETE', url: `/api/projects/${p.id}` });
    expect(existsSync(join(v.dir, 'audio', `${p.id}.wav`))).toBe(false);
    expect(existsSync(join(v.dir, 'exports', p.id))).toBe(false);
    expect(existsSync(v.path)).toBe(true); // user's original file is never deleted
  });
});
