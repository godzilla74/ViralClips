import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR, loadSettings, publicSettings, sanitize, saveSettings } from './config.js';
import { checkDeps } from './deps.js';
import {
  addExport, createProject, deleteProject, getLayout, listExportPaths, setLayout, getClip, getProject, getTranscript, listClips, listProjects, openDb,
  replaceClips, resetInterrupted, saveTranscript, setProjectStatus, updateClip, type Db,
} from './db.js';
import { findClips } from './clips/find.js';
import { JobBus } from './jobs.js';
import { makeProvider } from './llm/index.js';
import type { LlmProvider } from './llm/types.js';
import { transcribe as defaultTranscribe, type Transcriber } from './transcribe.js';
import { extractAudio, probe } from './media.js';
import { exportClip } from './export.js';
import { findPanels, sampleGrayFrames, validateLayout } from './layout.js';
import { planRender, renderPreview, type Kind } from './render.js';
import { execFile } from 'node:child_process';
import { pickFolder as defaultPickFolder, pickVideoFile } from './picker.js';
import { revealPath } from './platform.js';
import type { Settings } from './types.js';

export interface AppOptions {
  db?: Db; dataDir?: string;
  transcribe?: Transcriber;
  provider?: (s: Settings) => LlmProvider;
  pickFile?: () => Promise<string | null>;
  pickFolder?: () => Promise<string | null>;
  reveal?: (path: string) => Promise<void>;
}

export function buildApp(opts: AppOptions = {}) {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const db = opts.db ?? openDb(join(dataDir, 'viralclips.db'));
  const transcribe = opts.transcribe ?? defaultTranscribe;
  const provider = opts.provider ?? makeProvider;
  const jobs = new JobBus();
  resetInterrupted(db);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.decorate('jobs', jobs);
  // Local-only app: refuse DNS-rebinding (non-local Host) and cross-site (non-local Origin) requests.
  const isLocal = (h: string) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(h);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api')) return;
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    let originOk = true;
    if (req.headers.origin) {
      try { originOk = isLocal(new URL(req.headers.origin).hostname); } catch { originOk = false; }
    }
    if ((host && !isLocal(host)) || !originOk) return reply.code(403).send({ error: 'Forbidden' });
  });
  app.register(multipart, { limits: { fileSize: 50 * 1024 ** 3 } });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/setup', async () => checkDeps());
  app.get('/api/settings', async () => publicSettings(loadSettings(dataDir)));
  app.put('/api/settings', async (req) => {
    const body = sanitize((req.body ?? {}) as Record<string, unknown>);
    if (!body.openaiKey) delete body.openaiKey; // empty = keep existing
    return publicSettings(saveSettings(body, dataDir));
  });

  // Native OS file chooser: browsers can't reveal real file paths, but this server runs on the same machine.
  app.post('/api/pick-file', async (_req, reply) => {
    try {
      return { path: await (opts.pickFile ?? pickVideoFile)() };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.post('/api/pick-folder', async (_req, reply) => {
    try {
      return { path: await (opts.pickFolder ?? defaultPickFolder)() };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  // ---- projects ----
  app.post('/api/projects', async (req, reply) => {
    let videoPath: string;
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'No file uploaded' });
      mkdirSync(join(dataDir, 'uploads'), { recursive: true });
      videoPath = join(dataDir, 'uploads', `${randomUUID()}${extname(file.filename) || '.mp4'}`);
      await pipeline(file.file, createWriteStream(videoPath));
      (req as any).origName = file.filename;
    } else {
      videoPath = String((req.body as any)?.path ?? '').trim();
      if (!videoPath || !existsSync(videoPath) || !statSync(videoPath).isFile())
        return reply.code(400).send({ error: `File not found: ${videoPath}` });
    }
    const isUpload = videoPath.startsWith(join(dataDir, 'uploads'));
    try {
      const info = await probe(videoPath);
      if (!info.hasAudio) {
        if (isUpload) rmSync(videoPath, { force: true });
        return reply.code(400).send({ error: 'No audio track found in this video' });
      }
      const name = basename((req as any).origName ?? videoPath).replace(/\.[^.]+$/, '');
      return createProject(db, { name, videoPath, duration: info.duration });
    } catch (e) {
      if (isUpload) rmSync(videoPath, { force: true });
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.get('/api/projects', async () => listProjects(db));
  app.get('/api/projects/:id', async (req, reply) => {
    const p = getProject(db, (req.params as any).id);
    return p ?? reply.code(404).send({ error: 'Not found' });
  });
  app.delete('/api/projects/:id', async (req) => {
    const id = basename((req.params as any).id as string);
    const proj = getProject(db, id);
    deleteProject(db, id);
    rmSync(join(dataDir, 'audio', `${id}.wav`), { force: true });
    rmSync(defaultExportsDir(id), { recursive: true, force: true }); // never touches a user-chosen export folder
    // only delete the internal upload copy — never a file the user pointed us at
    if (proj?.videoPath.startsWith(join(dataDir, 'uploads'))) rmSync(proj.videoPath, { force: true });
    return { ok: true };
  });
  app.get('/api/projects/:id/video', async (req, reply) => {
    const p = getProject(db, (req.params as any).id);
    if (!p || !existsSync(p.videoPath)) return reply.code(404).send({ error: 'Not found' });
    const size = statSync(p.videoPath).size;
    const type = 'video/mp4';
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      reply.code(206).headers({
        'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes',
        'content-length': end - start + 1, 'content-type': type,
      });
      return reply.send(createReadStream(p.videoPath, { start, end }));
    }
    reply.headers({ 'accept-ranges': 'bytes', 'content-length': size, 'content-type': type });
    return reply.send(createReadStream(p.videoPath));
  });

  // ---- analysis ----
  async function runAnalysis(id: string) {
    const proj = getProject(db, id)!;
    const settings = loadSettings(dataDir);
    try {
      let t = getTranscript(db, id);
      if (!t) {
        setProjectStatus(db, id, 'transcribing');
        mkdirSync(join(dataDir, 'audio'), { recursive: true });
        const wav = join(dataDir, 'audio', `${id}.wav`);
        jobs.emit(id, { stage: 'transcribe', pct: 0, message: 'Extracting audio' });
        await extractAudio(proj.videoPath, wav);
        t = await transcribe(wav, {
          modelPath: join(dataDir, 'models', 'ggml-small.en.bin'),
          onProgress: (pct) => jobs.emit(id, { stage: 'transcribe', pct, message: 'Transcribing' }),
        });
        saveTranscript(db, id, t);
      }
      setProjectStatus(db, id, 'analyzing');
      const found = await findClips(t, provider(settings), settings, (pct) =>
        jobs.emit(id, { stage: 'analyze', pct, message: 'Finding the best clips' }));
      if (!found.length) throw new Error('No suitable clips found. Try a different model or a shorter minimum clip length.');
      replaceClips(db, id, found.map((c, i) => ({ ...c, selected: i < 5 })));
      setProjectStatus(db, id, 'ready');
      jobs.emit(id, { stage: 'analyze', pct: 100, done: true });
    } catch (e) {
      const message = (e as Error).message;
      setProjectStatus(db, id, 'error', message);
      jobs.emit(id, { stage: 'analyze', pct: 0, error: message, done: true });
    }
  }

  app.post('/api/projects/:id/analyze', async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!getProject(db, id)) return reply.code(404).send({ error: 'Not found' });
    if (jobs.isRunning(id)) return reply.code(409).send({ error: 'Job already running' });
    void jobs.runExclusive(id, () => runAnalysis(id));
    return reply.code(202).send({ started: true });
  });

  app.get('/api/projects/:id/events', (req, reply) => {
    const id = (req.params as any).id as string;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
    });
    const send = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ stage: 'analyze', pct: 0, message: 'connected', connected: true, running: jobs.isRunning(id) });
    const off = jobs.subscribe(id, send);
    req.raw.on('close', off);
    return reply;
  });

  app.get('/api/projects/:id/transcript', async (req, reply) =>
    getTranscript(db, (req.params as any).id) ?? reply.code(404).send({ error: 'No transcript yet' }));
  app.get('/api/projects/:id/clips', async (req) => listClips(db, (req.params as any).id));

  app.patch('/api/clips/:id', async (req, reply) => {
    const clip = getClip(db, (req.params as any).id);
    if (!clip) return reply.code(404).send({ error: 'Not found' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const proj = getProject(db, clip.projectId)!;
    const start = b.start === undefined ? clip.start : Number(b.start);
    const end = b.end === undefined ? clip.end : Number(b.end);
    if (!(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end && end <= proj.duration + 0.5))
      return reply.code(400).send({ error: 'Invalid start/end' });
    updateClip(db, clip.id, {
      start, end,
      ...(typeof b.title === 'string' ? { title: b.title.slice(0, 200) } : {}),
      ...(typeof b.selected === 'boolean' ? { selected: b.selected } : {}),
    });
    return getClip(db, clip.id);
  });

  // ---- export ----
  const defaultExportsDir = (id: string) => join(dataDir, 'exports', id);
  const reveal = opts.reveal ?? ((path: string) => revealPath(path));
  /** Exports this app made for the project (that still exist). Only these may be downloaded or revealed. */
  const exportedFiles = (id: string) => listExportPaths(db, id).filter((p) => existsSync(p));
  const findExport = (id: string, file: string) => exportedFiles(id).find((p) => basename(p) === file);

  app.post('/api/projects/:id/export', async (req, reply) => {
    const id = (req.params as any).id as string;
    const proj = getProject(db, id);
    if (!proj) return reply.code(404).send({ error: 'Not found' });
    const body = (req.body ?? {}) as { clipIds?: string[]; settings?: Partial<Settings> };
    const all = listClips(db, id);
    const clips = body.clipIds ? all.filter((c) => body.clipIds!.includes(c.id)) : all.filter((c) => c.selected);
    if (!clips.length) return reply.code(400).send({ error: 'No clips selected' });
    if (jobs.isRunning(id)) return reply.code(409).send({ error: 'Job already running' });
    const settings = { ...loadSettings(dataDir), ...sanitize((body.settings ?? {}) as Record<string, unknown>) };
    const outDir = settings.exportDir || defaultExportsDir(id);
    const words = getTranscript(db, id)?.words ?? [];
    const kinds: Kind[] = settings.outputs === 'both' ? ['vertical', 'wide'] : settings.outputs === 'wide' ? ['wide'] : ['vertical'];
    const layout = getLayout(db, id);
    let src: { w: number; h: number };
    try {
      const info = await probe(proj.videoPath);
      src = { w: info.width, h: info.height };
      for (const kind of kinds) planRender(kind, settings, layout, src); // fail fast, e.g. stack without a layout
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const steps = clips.length * kinds.length;
    void jobs.runExclusive(id, async () => {
      try {
        let step = 0;
        for (const clip of clips) {
          for (const kind of kinds) {
            const n = step++;
            const file = await exportClip({
              videoPath: proj.videoPath, clip, words, settings, outDir, kind, layout, src,
              onProgress: (p) => jobs.emit(id, {
                stage: 'export', pct: Math.round(((n + p / 100) / steps) * 100),
                message: `Exporting ${kind === 'wide' ? 'widescreen' : 'vertical'} clip ${n + 1} of ${steps}`,
              }),
            });
            addExport(db, id, file);
          }
        }
        jobs.emit(id, { stage: 'export', pct: 100, done: true });
      } catch (e) {
        jobs.emit(id, { stage: 'export', pct: 0, error: `Export failed: ${(e as Error).message}`, done: true });
      }
    });
    return reply.code(202).send({ started: true, count: steps, clips: clips.length, folder: outDir });
  });

  app.get('/api/projects/:id/exports', async (req) => {
    const id = (req.params as any).id as string;
    return exportedFiles(id).map((p) => ({
      file: basename(p), folder: dirname(p), size: statSync(p).size,
      url: `/api/exports/${id}/${encodeURIComponent(basename(p))}`,
    }));
  });

  app.get('/api/exports/:id/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const path = findExport(id, file);
    if (!path) return reply.code(404).send({ error: 'Not found' });
    reply.headers({
      'content-type': 'video/mp4', 'content-length': statSync(path).size,
      'content-disposition': `attachment; filename="${basename(path).replace(/"/g, '')}"`,
    });
    return reply.send(createReadStream(path));
  });

  app.post('/api/exports/:id/:file/reveal', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const path = findExport(id, file);
    if (!path) return reply.code(404).send({ error: 'Not found' });
    try {
      await reveal(path);
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ error: `Could not open the file manager: ${(e as Error).message}` });
    }
  });

  // ---- vertical layout (screen share + webcam) ----
  app.get('/api/projects/:id/layout', async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!getProject(db, id)) return reply.code(404).send({ error: 'Not found' });
    return { layout: getLayout(db, id) };
  });

  app.put('/api/projects/:id/layout', async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!getProject(db, id)) return reply.code(404).send({ error: 'Not found' });
    try {
      const layout = validateLayout(req.body);
      setLayout(db, id, layout);
      return { layout };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /** Finds moving panels from sampled frames; the browser finds the face on frames from /frame. */
  app.get('/api/projects/:id/layout/analyze', async (req, reply) => {
    const id = (req.params as any).id as string;
    const proj = getProject(db, id);
    if (!proj) return reply.code(404).send({ error: 'Not found' });
    try {
      const { frames, width, height } = await sampleGrayFrames(proj.videoPath, proj.duration, 24);
      const times = Array.from({ length: 10 }, (_, i) => +((proj.duration * (i + 0.5)) / 10).toFixed(2));
      return { panels: findPanels(frames), width, height, times, duration: proj.duration };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:id/frame', async (req, reply) => {
    const proj = getProject(db, (req.params as any).id);
    const t = Number((req.query as any).t);
    if (!proj) return reply.code(404).send({ error: 'Not found' });
    if (!Number.isFinite(t) || t < 0) return reply.code(400).send({ error: 'Invalid t' });
    const jpeg = await new Promise<Buffer>((resolve, reject) =>
      execFile('ffmpeg', ['-v', 'error', '-ss', String(Math.min(t, Math.max(0, proj.duration - 0.1))), '-i', proj.videoPath,
        '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', '-f', 'mjpeg', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }, (e, out) => (e || !out.length ? reject(e ?? new Error('no frame')) : resolve(out))))
      .catch(() => null);
    if (!jpeg) return reply.code(500).send({ error: 'Could not read a frame from the video' });
    return reply.header('content-type', 'image/jpeg').header('cache-control', 'private, max-age=300').send(jpeg);
  });

  // ---- preview: one still, rendered with exactly the export's filter graph ----
  app.get('/api/projects/:id/preview', async (req, reply) => {
    const id = (req.params as any).id as string;
    const q = req.query as Record<string, string | undefined>;
    const proj = getProject(db, id);
    if (!proj) return reply.code(404).send({ error: 'Not found' });
    const clip = listClips(db, id).find((c) => c.id === q.clip);
    if (!clip) return reply.code(404).send({ error: 'Clip not found' });
    if (q.kind !== 'vertical' && q.kind !== 'wide') return reply.code(400).send({ error: 'kind must be vertical or wide' });
    const tNum = q.t === undefined ? (clip.end - clip.start) / 2 : Number(q.t);
    if (!Number.isFinite(tNum)) return reply.code(400).send({ error: 'Invalid t' });
    const settings = {
      ...loadSettings(dataDir),
      ...sanitize({
        framing: q.framing, faceStyle: q.faceStyle, captionStyle: q.captionStyle,
        ...(q.captions !== undefined ? { captions: q.captions === '1' || q.captions === 'true' } : {}),
      }),
    };
    try {
      const info = await probe(proj.videoPath);
      const png = await renderPreview({
        videoPath: proj.videoPath, clip, words: getTranscript(db, id)?.words ?? [], settings,
        layout: getLayout(db, id), src: { w: info.width, h: info.height }, kind: q.kind, t: tNum,
      });
      return reply.header('content-type', 'image/png').header('cache-control', 'no-store').send(png);
    } catch (e) {
      const message = (e as Error).message;
      return reply.code(/layout/i.test(message) ? 400 : 500).send({ error: message });
    }
  });

  app.get('/api/llm/models', async (_req, reply) => {
    try {
      const p = provider(loadSettings(dataDir));
      return p.describeModels ? await p.describeModels() : (await p.listModels()).map((name) => ({ name, reasoning: false, vision: false }));
    } catch (e) {
      return reply.code(503).send({ error: (e as Error).message });
    }
  });

  // ---- built web UI (production) ----
  const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(join(webDist, 'index.html'))) {
    app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'));
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance { jobs: JobBus }
}
