import { execFile, spawn } from 'node:child_process';

export interface ProbeInfo { duration: number; hasAudio: boolean; width: number; height: number }

export function probe(path: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(new Error('Could not read video file (is it a valid video?)'));
        const j = JSON.parse(stdout);
        const v = j.streams?.find((s: any) => s.codec_type === 'video');
        if (!v) return reject(new Error('No video stream found'));
        resolve({
          duration: Number(j.format?.duration ?? v.duration ?? 0),
          hasAudio: j.streams.some((s: any) => s.codec_type === 'audio'),
          width: v.width, height: v.height,
        });
      });
  });
}

/** Runs a binary with an argument array; rejects with stderr tail on failure. */
export function runProc(bin: string, args: string[], onStderr?: (chunk: string) => void, onStdout?: (chunk: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    p.stderr.on('data', (d) => { const s = String(d); tail = (tail + s).slice(-2000); onStderr?.(s); });
    p.stdout.on('data', (d) => onStdout?.(String(d)));
    p.on('error', (e) => reject(new Error(`${bin} failed to start: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${tail.trim().split('\n').slice(-3).join(' | ')}`))));
  });
}

export const extractAudio = (videoPath: string, outWav: string) =>
  runProc('ffmpeg', ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav]);
