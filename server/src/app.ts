import Fastify from 'fastify';
import { loadSettings, publicSettings, saveSettings } from './config.js';
import { checkDeps } from './deps.js';
import type { Settings } from './types.js';

export function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/setup', async () => checkDeps());
  app.get('/api/settings', async () => publicSettings(loadSettings()));
  app.put('/api/settings', async (req) => {
    const body = (req.body ?? {}) as Partial<Settings>;
    if (!body.openaiKey) delete body.openaiKey; // empty = keep existing
    return publicSettings(saveSettings(body));
  });
  return app;
}
