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

const ENUMS = {
  provider: ['ollama', 'openai'], framing: ['crop', 'blur', 'original'], captionStyle: ['bold', 'clean', 'karaoke'],
} as const;
const NUMS: Record<string, [number, number]> = { clipMinSec: [5, 600], clipMaxSec: [10, 900], clipCount: [1, 30] };
const STRS = ['ollamaModel', 'openaiModel', 'openaiKey'] as const;

/** Keeps only known fields with valid values; invalid values are dropped (previous value stays). */
export function sanitize(p: Record<string, unknown> = {}): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [k, vals] of Object.entries(ENUMS)) if ((vals as readonly unknown[]).includes(p[k])) out[k] = p[k];
  for (const [k, [lo, hi]] of Object.entries(NUMS)) {
    const n = typeof p[k] === 'number' ? p[k] : NaN;
    if (Number.isFinite(n)) out[k] = Math.min(hi, Math.max(lo, Math.round(n as number)));
  }
  for (const k of STRS) if (typeof p[k] === 'string') out[k] = (p[k] as string).trim().slice(0, 300);
  if (typeof p.captions === 'boolean') out.captions = p.captions;
  return out as Partial<Settings>;
}

export function saveSettings(patch: Partial<Settings>, dir = DATA_DIR): Settings {
  mkdirSync(dir, { recursive: true });
  const next = { ...loadSettings(dir), ...sanitize(patch as Record<string, unknown>) };
  if (next.clipMaxSec < next.clipMinSec) next.clipMaxSec = next.clipMinSec;
  const f = join(dir, 'config.json');
  writeFileSync(f, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(f, 0o600);
  return next;
}

export function publicSettings(s: Settings) {
  const { openaiKey, ...rest } = s;
  return { ...rest, hasKey: Boolean(openaiKey) };
}
