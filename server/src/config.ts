import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from './types.js';

export const DATA_DIR =
  process.env.VC_DATA ?? fileURLToPath(new URL('../../data', import.meta.url));

export const DEFAULTS: Settings = {
  provider: 'ollama',
  ollamaModel: 'qwen2.5:14b',
  openaiModel: 'gpt-4o-mini',
  clipMinSec: 30,
  clipMaxSec: 60,
  clipCount: 10,
  captions: true,
  framing: 'crop',
  captionStyle: 'karaoke',
};

export function loadSettings(dir = DATA_DIR): Settings {
  const f = join(dir, 'config.json');
  if (!existsSync(f)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(f, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>, dir = DATA_DIR): Settings {
  mkdirSync(dir, { recursive: true });
  const next = { ...loadSettings(dir), ...patch };
  const f = join(dir, 'config.json');
  writeFileSync(f, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(f, 0o600);
  return next;
}

export function publicSettings(s: Settings) {
  const { openaiKey, ...rest } = s;
  return { ...rest, hasKey: Boolean(openaiKey) };
}
