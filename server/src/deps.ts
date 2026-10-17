import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

export interface DepStatus { name: string; ok: boolean; hint: string }

export const WHISPER_MODEL = join(DATA_DIR, 'models', 'ggml-small.en.bin');
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin';

const run = (bin: string, args: string[]) =>
  new Promise<boolean>((res) => execFile(bin, args, { timeout: 5000 }, (e) => res(!e)));

export async function checkDeps(
  bins: { ffmpeg?: string; ffprobe?: string; whisper?: string } = {},
): Promise<DepStatus[]> {
  const ffmpeg = bins.ffmpeg ?? 'ffmpeg';
  const ffprobe = bins.ffprobe ?? 'ffprobe';
  const whisper = bins.whisper ?? 'whisper-cli';
  const ollama = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) })
    .then((r) => r.ok).catch(() => false);
  return [
    { name: 'ffmpeg', ok: await run(ffmpeg, ['-version']), hint: 'brew install ffmpeg' },
    { name: 'ffprobe', ok: await run(ffprobe, ['-version']), hint: 'brew install ffmpeg' },
    { name: 'whisper-cli', ok: await run(whisper, ['--help']), hint: 'brew install whisper-cpp' },
    {
      name: 'whisper model',
      ok: existsSync(WHISPER_MODEL),
      hint: `mkdir -p "${join(DATA_DIR, 'models')}" && curl -L -o "${WHISPER_MODEL}" ${MODEL_URL}`,
    },
    { name: 'ollama', ok: ollama, hint: 'Start Ollama (open the app or run `ollama serve`) — only needed for the Ollama provider' },
  ];
}
