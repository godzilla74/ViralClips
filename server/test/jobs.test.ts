import { describe, it, expect } from 'vitest';
import { JobBus } from '../src/jobs.js';
import { buildApp } from '../src/app.js';
import { openDb, createProject, setProjectStatus, getProject } from '../src/db.js';
import { makeVideo } from './helpers.js';
import type { LlmProvider } from '../src/llm/types.js';
import type { Transcriber } from '../src/transcribe.js';

describe('JobBus', () => {
  it('delivers events and unsubscribes', () => {
    const b = new JobBus(); const got: number[] = [];
    const off = b.subscribe('p', (e) => got.push(e.pct));
    b.emit('p', { stage: 'analyze', pct: 1 }); off(); b.emit('p', { stage: 'analyze', pct: 2 });
    expect(got).toEqual([1]);
  });
  it('rejects a concurrent job for the same project', async () => {
    const b = new JobBus();
    let release!: () => void;
    const first = b.runExclusive('p', () => new Promise<void>((r) => { release = r; }));
    await expect(b.runExclusive('p', async () => {})).rejects.toThrow('Job already running');
    release(); await first;
    await expect(b.runExclusive('p', async () => 1)).resolves.toBe(1);
  });
});

const words = Array.from({ length: 120 }, (_, i) => ({ text: (i + 1) % 10 === 0 ? 'end.' : 'w', start: i * 0.5, end: i * 0.5 + 0.5 }));
const stubTranscribe: Transcriber = async () => ({ language: 'en', duration: 60, words });
const stubProvider = (reply: string): LlmProvider => ({ listModels: async () => ['m'], completeJSON: async () => reply });

async function setup(reply: string, tr: Transcriber = stubTranscribe) {
  const v = makeVideo({ seconds: 60, w: 320, h: 180 });
  const app = buildApp({ db: openDb(':memory:'), dataDir: v.dir, transcribe: tr, provider: () => stubProvider(reply) });
  const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { path: v.path } })).json();
  return { app, p };
}

describe('analyze routes', () => {
  const reply = JSON.stringify({ clips: [{ start: 0, end: 40, title: 'T', score: 90, reason: 'r' }] });
  it('analyzes, lists clips, edits with validation', async () => {
    const { app, p } = await setup(reply);
    expect((await app.inject({ method: 'POST', url: `/api/projects/${p.id}/analyze` })).statusCode).toBe(202);
    await app.jobs.whenIdle(p.id);
    expect((await app.inject({ url: `/api/projects/${p.id}` })).json().status).toBe('ready');
    const clips = (await app.inject({ url: `/api/projects/${p.id}/clips` })).json();
    expect(clips).toHaveLength(1);
    expect((await app.inject({ url: `/api/projects/${p.id}/transcript` })).json().words.length).toBe(120);
    const bad = await app.inject({ method: 'PATCH', url: `/api/clips/${clips[0].id}`, payload: { start: 30, end: 20 } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: `/api/clips/${clips[0].id}`, payload: { title: 'New', selected: false } });
    expect(ok.json()).toMatchObject({ title: 'New', selected: false });
  });
  it('marks project error for silent transcript', async () => {
    const { app, p } = await setup(reply, async () => ({ language: 'en', duration: 3, words: [] }));
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/analyze` });
    await app.jobs.whenIdle(p.id);
    expect((await app.inject({ url: `/api/projects/${p.id}` })).json()).toMatchObject({ status: 'error', error: 'No speech detected' });
  });
});

describe('robustness', () => {
  const good = JSON.stringify({ clips: [{ start: 0, end: 40, title: 'T', score: 90, reason: 'r' }] });
  it('keeps existing clips and reports an error when a re-run finds nothing', async () => {
    let current = good;
    const v = makeVideo({ seconds: 60, w: 320, h: 180 });
    const app = buildApp({ db: openDb(':memory:'), dataDir: v.dir, transcribe: stubTranscribe, provider: () => stubProvider(current) });
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { path: v.path } })).json();
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/analyze` });
    await app.jobs.whenIdle(p.id);
    current = '{"clips":[]}';
    await app.inject({ method: 'POST', url: `/api/projects/${p.id}/analyze` });
    await app.jobs.whenIdle(p.id);
    expect((await app.inject({ url: `/api/projects/${p.id}/clips` })).json()).toHaveLength(1);
    expect((await app.inject({ url: `/api/projects/${p.id}` })).json()).toMatchObject({ status: 'error' });
  });
  it('resets projects interrupted by a restart', () => {
    const db = openDb(':memory:');
    const pr = createProject(db, { name: 'a', videoPath: '/x', duration: 1 });
    setProjectStatus(db, pr.id, 'transcribing');
    buildApp({ db, dataDir: makeVideo().dir });
    expect(getProject(db, pr.id)).toMatchObject({ status: 'error' });
  });
});
