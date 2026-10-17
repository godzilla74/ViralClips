import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { whisperBinary } from './deps.js';
import { runProc } from './media.js';
import type { Transcript, Word } from './types.js';

export function parseWhisperJson(raw: any): Transcript {
  const words: Word[] = [];
  let cur: Word | null = null;
  for (const tok of raw?.transcription ?? []) {
    const text: string = tok.text ?? '';
    if (/^\[_.*\]$/.test(text.trim())) continue; // special tokens
    if (!text.trim()) continue;
    if (text.startsWith(' ') && !/[\p{L}\p{N}]/u.test(text)) continue; // stray punctuation-only token
    const start = tok.offsets.from / 1000;
    const end = tok.offsets.to / 1000;
    if (cur && !text.startsWith(' ')) {
      cur.text += text.trim();
      cur.end = end;
    } else {
      if (cur) words.push(cur);
      cur = { text: text.trim(), start, end };
    }
  }
  if (cur) words.push(cur);
  return {
    language: raw?.result?.language ?? 'en',
    duration: words.length ? words[words.length - 1].end : 0,
    words,
  };
}

export interface TranscribeOpts { modelPath: string; onProgress: (pct: number) => void }
export type Transcriber = (wavPath: string, opts: TranscribeOpts) => Promise<Transcript>;

export const transcribe: Transcriber = async (wavPath, { modelPath, onProgress }) => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-whisper-'));
  const base = join(dir, 'out');
  try {
    await runProc(whisperBinary(), ['-m', modelPath, '-f', wavPath, '-ojf', '-of', base, '-ml', '1', '-sow', '-pp'], (chunk) => {
      const m = [...chunk.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
      if (m) onProgress(Number(m[1]));
    });
    return parseWhisperJson(JSON.parse(readFileSync(`${base}.json`, 'utf8')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
