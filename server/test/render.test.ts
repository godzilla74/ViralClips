import { describe, it, expect } from 'vitest';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { exportClip } from '../src/export.js';
import { planRender, buildGraph, renderPreview } from '../src/render.js';
import { probe } from '../src/media.js';
import { DEFAULTS } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { openDb, replaceClips, listClips } from '../src/db.js';
import { makeComposite } from './helpers.js';
import type { Clip, Layout, Settings, Word } from '../src/types.js';

const words: Word[] = Array.from({ length: 12 }, (_, i) => ({ text: i === 3 ? 'it\'s {odd}\\' : 'word', start: 0.2 + i * 0.25, end: 0.4 + i * 0.25 }));
const clip: Clip = { id: 'abcdef123456', projectId: 'p', start: 0.5, end: 3.5, title: 'Stack "test" é', score: 90, reason: '', selected: true };
const layoutFor = (c: ReturnType<typeof makeComposite>): Layout => ({
  screen: c.screen,
  facePanel: c.webcam,
  face: { x: c.webcam.x + 0.02, y: c.webcam.y + 0.1, w: c.webcam.w - 0.04, h: 0.3 },
});
const SRC = { w: 640, h: 360 };
const settings = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, captions: true, ...o });

describe('planRender', () => {
  it('vertical framings are 1080x1920; wide keeps the source size (even dimensions)', () => {
    for (const framing of ['crop', 'blur', 'original'] as const) {
      const p = planRender('vertical', settings({ framing }), null, SRC);
      expect([p.outW, p.outH]).toEqual([1080, 1920]);
    }
    const w = planRender('wide', settings(), null, { w: 641, h: 361 });
    expect([w.outW, w.outH]).toEqual([640, 360]);
    expect(w.captionW).toBeLessThan(w.outW);
  });
  it('stack without a usable layout explains what to do', () => {
    expect(() => planRender('vertical', settings({ framing: 'stack' }), null, SRC)).toThrow(/layout/i);
    expect(() => planRender('vertical', settings({ framing: 'stack' }), { screen: null, face: null, facePanel: null }, SRC)).toThrow(/layout/i);
  });
  it('buildGraph adds a caption overlay only when asked', () => {
    const p = planRender('vertical', settings({ framing: 'crop' }), null, SRC);
    expect(buildGraph(p, false)).toMatch(/\[vout\]$/);
    expect(buildGraph(p, false)).not.toContain('[1:v]');
    expect(buildGraph(p, true)).toContain('[1:v]');
  });
});

describe('export formats', () => {
  it.each(['card', 'full'] as const)('stack layout exports 1080x1920 (%s)', async (faceStyle) => {
    const c = makeComposite();
    const path = await exportClip({
      videoPath: c.path, clip, words, outDir: join(c.dir, 'out'), onProgress: () => {},
      settings: settings({ framing: 'stack', faceStyle }), kind: 'vertical', layout: layoutFor(c),
    });
    const info = await probe(path);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(Math.abs(info.duration - 3)).toBeLessThan(0.4);
    expect(path).toMatch(/-vertical\.mp4$/);
    rmSync(c.dir, { recursive: true, force: true });
  }, 90000);
  it('wide export keeps the source resolution and burns captions', async () => {
    const c = makeComposite();
    const path = await exportClip({
      videoPath: c.path, clip, words, outDir: join(c.dir, 'out'), onProgress: () => {},
      settings: settings({ captions: true }), kind: 'wide',
    });
    const info = await probe(path);
    expect([info.width, info.height]).toEqual([640, 360]);
    expect(path).toMatch(/-wide\.mp4$/);
    expect(info.hasAudio).toBe(true);
  }, 90000);
  it('both formats can coexist in one folder without clobbering each other', async () => {
    const c = makeComposite();
    const out = join(c.dir, 'out');
    for (const kind of ['vertical', 'wide'] as const) {
      await exportClip({ videoPath: c.path, clip, words, outDir: out, onProgress: () => {}, settings: settings({ captions: false }), kind });
    }
    expect(readdirSync(out).sort()).toHaveLength(2);
  }, 90000);
});

describe('renderPreview', () => {
  const dims = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
  it('renders a PNG still with the same dimensions the export will have', async () => {
    const c = makeComposite();
    const base = { videoPath: c.path, clip, words, src: SRC, t: 1 };
    const v = await renderPreview({ ...base, kind: 'vertical', settings: settings({ framing: 'stack' }), layout: layoutFor(c) });
    expect(v.subarray(1, 4).toString()).toBe('PNG');
    expect(dims(v)).toEqual([1080, 1920]);
    const w = await renderPreview({ ...base, kind: 'wide', settings: settings(), layout: null });
    expect(dims(w)).toEqual([640, 360]);
    const plain = await renderPreview({ ...base, kind: 'vertical', settings: settings({ framing: 'blur', captions: false }), layout: null });
    expect(dims(plain)).toEqual([1080, 1920]);
  }, 90000);
});

describe('preview + layout + export routes', () => {
  async function setup() {
    const c = makeComposite(6);
    const db = openDb(':memory:');
    const app = buildApp({ db, dataDir: c.dir });
    const p = (await app.inject({ method: 'POST', url: '/api/projects', payload: { path: c.path } })).json();
    replaceClips(db, p.id, [{ start: 0.5, end: 4, title: 'Clip', score: 80, reason: 'r', selected: true }]);
    return { app, db, p, c, clipId: listClips(db, p.id)[0].id };
  }
  it('analyze finds panels; layout can be saved, validated and read back', async () => {
    const { app, p, c } = await setup();
    const a = (await app.inject({ url: `/api/projects/${p.id}/layout/analyze` })).json();
    expect(a.panels.length).toBeGreaterThanOrEqual(2);
    expect([a.width, a.height]).toEqual([640, 360]);
    expect(a.times.length).toBeGreaterThan(3);
    expect((await app.inject({ url: `/api/projects/${p.id}/layout` })).json().layout).toBeNull();
    const bad = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}/layout`, payload: { screen: { x: 2, y: 0, w: 1, h: 1 }, face: null } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}/layout`, payload: layoutFor(c) });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ url: `/api/projects/${p.id}/layout` })).json().layout.screen.w).toBeCloseTo(c.screen.w);
  }, 90000);
  it('serves source frames as JPEG for face detection', async () => {
    const { app, p } = await setup();
    const r = await app.inject({ url: `/api/projects/${p.id}/frame?t=1` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.rawPayload[0]).toBe(0xff);
    expect((await app.inject({ url: `/api/projects/${p.id}/frame?t=abc` })).statusCode).toBe(400);
  }, 60000);
  it('preview returns a PNG; stack without a layout is a clear 400', async () => {
    const { app, p, c, clipId } = await setup();
    const q = (extra: string) => `/api/projects/${p.id}/preview?clip=${clipId}&t=1&${extra}`;
    const wide = await app.inject({ url: q('kind=wide&captions=0') });
    expect(wide.statusCode).toBe(200);
    expect(wide.headers['content-type']).toBe('image/png');
    const noLayout = await app.inject({ url: q('kind=vertical&framing=stack') });
    expect(noLayout.statusCode).toBe(400);
    expect(noLayout.json().error).toMatch(/layout/i);
    await app.inject({ method: 'PUT', url: `/api/projects/${p.id}/layout`, payload: layoutFor(c) });
    const stack = await app.inject({ url: q('kind=vertical&framing=stack&faceStyle=card&captions=1&captionStyle=karaoke') });
    expect(stack.statusCode).toBe(200);
    expect([stack.rawPayload.readUInt32BE(16), stack.rawPayload.readUInt32BE(20)]).toEqual([1080, 1920]);
    expect((await app.inject({ url: q('kind=banana') })).statusCode).toBe(400);
  }, 90000);
  it('exporting "both" writes a vertical and a wide file per clip; stack needs a layout', async () => {
    const { app, p, c } = await setup();
    const noLayout = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: { settings: { framing: 'stack', outputs: 'vertical', captions: false } } });
    expect(noLayout.statusCode).toBe(400);
    await app.inject({ method: 'PUT', url: `/api/projects/${p.id}/layout`, payload: layoutFor(c) });
    const ex = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/export`, payload: { settings: { framing: 'stack', outputs: 'both', captions: false } } });
    expect(ex.statusCode).toBe(202);
    expect(ex.json().count).toBe(2);
    await app.jobs.whenIdle(p.id);
    const files = (await app.inject({ url: `/api/projects/${p.id}/exports` })).json().map((f: any) => f.file).sort();
    expect(files).toHaveLength(2);
    expect(files.some((f: string) => f.endsWith('-vertical.mp4'))).toBe(true);
    expect(files.some((f: string) => f.endsWith('-wide.mp4'))).toBe(true);
  }, 120000);
});
