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
  addExport, createProject, deleteProject, listExportPaths, getClip, getProject, getTranscript, listClips, listProjects, openDb,
  replaceClips, resetInterrupted, saveTranscript, setProjectStatus, updateClip, type Db,
} from './db.js';
import { findClips } from './clips/find.js';
import { JobBus } from './jobs.js';
import { makeProvider } from './llm/index.js';
import type { LlmProvider } from './llm/types.js';
import { transcribe as defaultTranscribe, type Transcriber } from './transcribe.js';
import { extractAudio, probe } from './media.js';
import { exportClip } from './export.js';
import { pickFolder as defaultPickFolder, pickVideoFile } from './picker.js';
import { execFile } from 'node:child_process';
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

  // Native OS file chooser: browsers can't reveal real file paths, but this server runs on the same Mac.
  app.post('/api/pick-file', async (_req, reply) => {
    if (!opts.pickFile && process.platform !== 'darwin') return reply.code(501).send({ error: 'The file chooser is only available on macOS. Paste the file path instead.' });
    try {
      return { path: await (opts.pickFile ?? pickVideoFile)() };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.post('/api/pick-folder', async (_req, reply) => {
    if (!opts.pickFolder && process.platform !== 'darwin') return reply.code(501).send({ error: 'The folder chooser is only available on macOS. Type the folder path instead.' });
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
  const reveal = opts.reveal ?? ((path: string) => new Promise<void>((res, rej) => execFile('open', ['-R', path], (e) => (e ? rej(e) : res()))));
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
    void jobs.runExclusive(id, async () => {
      try {
        for (const [i, clip] of clips.entries()) {
          const file = await exportClip({
            videoPath: proj.videoPath, clip, words, settings, outDir,
            onProgress: (p) => jobs.emit(id, {
              stage: 'export', pct: Math.round(((i + p / 100) / clips.length) * 100),
              message: `Exporting clip ${i + 1} of ${clips.length}`,
            }),
          });
          addExport(db, id, file);
        }
        jobs.emit(id, { stage: 'export', pct: 100, done: true });
      } catch (e) {
        jobs.emit(id, { stage: 'export', pct: 0, error: `Export failed: ${(e as Error).message}`, done: true });
      }
    });
    return reply.code(202).send({ started: true, count: clips.length, folder: outDir });
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
      return reply.code(500).send({ error: `Could not open Finder: ${(e as Error).message}` });
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
