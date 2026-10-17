import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';
import type { Platform } from './platform.js';

export interface DepStatus { name: string; ok: boolean; hint: string }

export const WHISPER_MODEL = join(DATA_DIR, 'models', 'ggml-small.en.bin');

/** Finds `name` under `dir`, a few levels deep (zip/build layouts vary). Mirrors scripts/setup-lib.mjs. */
export function findBinary(dir: string, name: string, depth = 3): string | null {
  if (depth < 0 || !existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true });
  const hit = entries.find((e) => e.isFile() && e.name === name);
  if (hit) return join(dir, hit.name);
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findBinary(join(dir, e.name), name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** whisper-cli: $VC_WHISPER, then data/bin (installed by `npm run setup`), then PATH. */
export function whisperBinary(o: { dataDir?: string; env?: NodeJS.ProcessEnv; platform?: Platform } = {}): string {
  const { dataDir = DATA_DIR, env = process.env, platform = process.platform } = o;
  const name = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  if (env.VC_WHISPER && existsSync(env.VC_WHISPER)) return env.VC_WHISPER;
  return findBinary(join(dataDir, 'bin'), name) ?? name;
}

export function installHint(tool: 'ffmpeg' | 'whisper' | 'ollama', platform: Platform = process.platform): string {
  const setup = 'Easiest: run `npm run setup`.';
  if (tool === 'ffmpeg') {
    const cmd = platform === 'darwin' ? 'brew install ffmpeg'
      : platform === 'win32' ? 'winget install Gyan.FFmpeg (then open a new terminal)'
      : 'sudo apt install ffmpeg  (or: sudo dnf install ffmpeg / sudo pacman -S ffmpeg)';
    return `${setup} Or: ${cmd}`;
  }
  if (tool === 'whisper') {
    const cmd = platform === 'darwin' ? 'brew install whisper-cpp'
      : platform === 'win32' ? 'download whisper-bin-x64.zip from github.com/ggml-org/whisper.cpp/releases into data/bin'
      : 'build whisper.cpp (cmake) and put whisper-cli on your PATH';
    return `${setup} Or: ${cmd}`;
  }
  return 'Install Ollama from https://ollama.com/download and start it — only needed for the Ollama provider';
}

const run = (bin: string, args: string[]) =>
  new Promise<boolean>((res) => execFile(bin, args, { timeout: 5000 }, (e) => res(!e)));

export async function checkDeps(
  bins: { ffmpeg?: string; ffprobe?: string; whisper?: string } = {},
): Promise<DepStatus[]> {
  const ffmpeg = bins.ffmpeg ?? 'ffmpeg';
  const ffprobe = bins.ffprobe ?? 'ffprobe';
  const whisper = bins.whisper ?? whisperBinary();
  const ollama = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok).catch(() => false);
  return [
    { name: 'ffmpeg', ok: await run(ffmpeg, ['-version']), hint: installHint('ffmpeg') },
    { name: 'ffprobe', ok: await run(ffprobe, ['-version']), hint: installHint('ffmpeg') },
    { name: 'whisper-cli', ok: await run(whisper, ['--help']), hint: installHint('whisper') },
    {
      name: 'whisper model',
      ok: existsSync(WHISPER_MODEL),
      hint: 'Run `npm run setup` (downloads ~470 MB to data/models/ggml-small.en.bin)',
    },
    { name: 'ollama', ok: ollama, hint: installHint('ollama') },
  ];
}
