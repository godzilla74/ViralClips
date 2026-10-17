import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR, loadSettings, publicSettings, saveSettings } from './config.js';
import { checkDeps } from './deps.js';
import { createProject, deleteProject, getProject, listProjects, openDb, type Db } from './db.js';
import { probe } from './media.js';
import type { Settings } from './types.js';

export interface AppOptions { db?: Db; dataDir?: string }

export function buildApp(opts: AppOptions = {}) {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const db = opts.db ?? openDb(join(dataDir, 'viralclips.db'));
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
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

  return app;
}
