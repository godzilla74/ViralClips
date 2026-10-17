import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { saveSettings } from '../src/config.js';
import { makeVideo } from './helpers.js';

const words = Array.from({ length: 120 }, (_, i) => ({ text: (i + 1) % 10 === 0 ? 'end.' : 'w', start: i * 0.5, end: i * 0.5 + 0.4 }));
const reply = JSON.stringify({ clips: [{ start_line: 0, end_line: 3, title: 'Great', score: 90, reason: 'r' }] });

async function setup(dest: string, revealed: string[] = []) {
  const v = makeVideo({ seconds: 60, w: 320, h: 180 });
  saveSettings({ exportDir: dest }, v.dir);
  const app = buildApp({
    db: openDb(':memory:'), dataDir: v.dir,
    transcribe: async () => ({ language: 'en', duration: 60, words }),
    provider: () => ({ listModels: async () => [], completeJSON: async () => reply }),
    reveal: async (path) => { revealed.push(path); },
  });
  const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { path: v.path } })).json();
  await app.inject({ method: 'POST', url: `/api/projects/${p.id}/analyze` });
  await app.jobs.whenIdle(p.id);
  return { app, p, v };
}

describe('export destination', () => {
  it('writes into the chosen folder (created if missing), lists, downloads and reveals it', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'vc dest é-')), 'My Shorts');
    const revealed: string[] = [];
    const { app, p } = await setup(dest, revealed);
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: { settings: { captions: false } } });
    await app.jobs.whenIdle(p.id);
    expect(readdirSync(dest).filter((f) => f.endsWith('.mp4'))).toHaveLength(1);
    const list = (await app.inject({ url: `/api/projects/${p.id}/exports` })).json();
    expect(list).toHaveLength(1);
    expect(list[0].folder).toBe(dest);
    expect((await app.inject({ url: list[0].url })).statusCode).toBe(200);
    const rv = await app.inject({ method: 'POST', url: list[0].url + '/reveal' });
    expect(rv.statusCode).toBe(200);
    expect(revealed).toEqual([join(dest, list[0].file)]);
  });
  it('defaults to the app folder when no destination is set', async () => {
    const { app, p, v } = await setup('');
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: { settings: { captions: false } } });
    await app.jobs.whenIdle(p.id);
    const list = (await app.inject({ url: `/api/projects/${p.id}/exports` })).json();
    expect(list[0].folder).toBe(join(v.dir, 'exports', p.id));
  });
  it('reports an unwritable destination as an export error instead of crashing', async () => {
    const { app, p } = await setup('/proc/definitely/not/writable');
    const events: any[] = [];
    app.jobs.subscribe(p.id, (e) => events.push(e));
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: { settings: { captions: false } } });
    await app.jobs.whenIdle(p.id);
    expect(events.at(-1)).toMatchObject({ stage: 'export', done: true });
    expect(events.at(-1).error).toBeTruthy();
  });
  it('never deletes files exported to the user\'s own folder when the project is deleted', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'vc dest-')), 'out');
    const { app, p } = await setup(dest);
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: { settings: { captions: false } } });
    await app.jobs.whenIdle(p.id);
    await app.inject({ method: 'DELETE', url: `/api/projects/${p.id}` });
    expect(readdirSync(dest).filter((f) => f.endsWith('.mp4'))).toHaveLength(1);
    expect(existsSync(dest)).toBe(true);
  });
  it('refuses to reveal or download paths that were not exported by this app', async () => {
    const { app, p } = await setup('');
    expect((await app.inject({ method: 'POST', url: `/api/exports/${p.id}/..%2F..%2Fconfig.json/reveal` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/exports/${p.id}/..%2F..%2Fconfig.json` })).statusCode).toBe(404);
  });
});
