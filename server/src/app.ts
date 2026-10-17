import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR, loadSettings, publicSettings, saveSettings } from './config.js';
import { checkDeps } from './deps.js';
import {
  createProject, deleteProject, getClip, getProject, getTranscript, listClips, listProjects, openDb,
  replaceClips, saveTranscript, setProjectStatus, updateClip, type Db,
} from './db.js';
import { findClips } from './clips/find.js';
import { JobBus } from './jobs.js';
import { makeProvider } from './llm/index.js';
import type { LlmProvider } from './llm/types.js';
import { transcribe as defaultTranscribe, type Transcriber } from './transcribe.js';
import { extractAudio, probe } from './media.js';
import { exportClip } from './export.js';
import type { Settings } from './types.js';

export interface AppOptions {
  db?: Db; dataDir?: string;
  transcribe?: Transcriber;
  provider?: (s: Settings) => LlmProvider;
}

export function buildApp(opts: AppOptions = {}) {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const db = opts.db ?? openDb(join(dataDir, 'viralclips.db'));
  const transcribe = opts.transcribe ?? defaultTranscribe;
  const provider = opts.provider ?? makeProvider;
  const jobs = new JobBus();
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.decorate('jobs', jobs);
  app.register(multipart, { limits: { fileSize: 50 * 1024 ** 3 } });

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/setup', async () => checkDeps());
  app.get('/api/settings', async () => publicSettings(loadSettings(dataDir)));
  app.put('/api/settings', async (req) => {
    const body = (req.body ?? {}) as Partial<Settings>;
    if (!body.openaiKey) delete body.openaiKey; // empty = keep existing
    return publicSettings(saveSettings(body, dataDir));
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
    try {
      const info = await probe(videoPath);
      if (!info.hasAudio) return reply.code(400).send({ error: 'No audio track found in this video' });
      const name = basename((req as any).origName ?? videoPath).replace(/\.[^.]+$/, '');
      return createProject(db, { name, videoPath, duration: info.duration });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });
  app.get('/api/projects', async () => listProjects(db));
  app.get('/api/projects/:id', async (req, reply) => {
    const p = getProject(db, (req.params as any).id);
    return p ?? reply.code(404).send({ error: 'Not found' });
  });
  app.delete('/api/projects/:id', async (req) => {
    deleteProject(db, (req.params as any).id);
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
  const exportsDir = (id: string) => join(dataDir, 'exports', id);

  app.post('/api/projects/:id/export', async (req, reply) => {
    const id = (req.params as any).id as string;
    const proj = getProject(db, id);
    if (!proj) return reply.code(404).send({ error: 'Not found' });
    const body = (req.body ?? {}) as { clipIds?: string[]; settings?: Partial<Settings> };
    const all = listClips(db, id);
    const clips = body.clipIds ? all.filter((c) => body.clipIds!.includes(c.id)) : all.filter((c) => c.selected);
    if (!clips.length) return reply.code(400).send({ error: 'No clips selected' });
    if (jobs.isRunning(id)) return reply.code(409).send({ error: 'Job already running' });
    const settings = { ...loadSettings(dataDir), ...(body.settings ?? {}) };
    const words = getTranscript(db, id)?.words ?? [];
    void jobs.runExclusive(id, async () => {
      try {
        const files: string[] = [];
        for (const [i, clip] of clips.entries()) {
          const file = await exportClip({
            videoPath: proj.videoPath, clip, words, settings, outDir: exportsDir(id),
            onProgress: (p) => jobs.emit(id, {
              stage: 'export', pct: Math.round(((i + p / 100) / clips.length) * 100),
              message: `Exporting clip ${i + 1} of ${clips.length}`,
            }),
          });
          files.push(file);
        }
        jobs.emit(id, { stage: 'export', pct: 100, done: true });
      } catch (e) {
        jobs.emit(id, { stage: 'export', pct: 0, error: (e as Error).message, done: true });
      }
    });
    return reply.code(202).send({ started: true, count: clips.length });
  });

  app.get('/api/projects/:id/exports', async (req) => {
    const id = (req.params as any).id as string;
    const dir = exportsDir(id);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.mp4')).sort()
      .map((f) => ({ file: f, size: statSync(join(dir, f)).size, url: `/api/exports/${id}/${encodeURIComponent(f)}` }));
  });

  app.get('/api/exports/:id/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const path = join(exportsDir(basename(id)), basename(file));
    if (!existsSync(path)) return reply.code(404).send({ error: 'Not found' });
    reply.headers({
      'content-type': 'video/mp4', 'content-length': statSync(path).size,
      'content-disposition': `attachment; filename="${basename(file).replace(/"/g, '')}"`,
    });
    return reply.send(createReadStream(path));
  });

  app.get('/api/llm/models', async (_req, reply) => {
    try {
      return await provider(loadSettings(dataDir)).listModels();
    } catch (e) {
      return reply.code(503).send({ error: (e as Error).message });
    }
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance { jobs: JobBus }
}
