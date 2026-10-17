import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankPng, buildCaptionSegments, renderSegmentPng} from './captions.js';
import { runProc } from './media.js';
import type { Clip, Settings, Word } from './types.js';

export interface ExportOpts {
  videoPath: string; clip: Clip; words: Word[]; settings: Settings;
  outDir: string; onProgress: (pct: number) => void;
}

const BASE: Record<Settings['framing'], string> = {
  crop: '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
  blur:
    '[0:v]split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:6[bg];' +
    '[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1',
  original: '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
};

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'clip';

export async function exportClip(o: ExportOpts): Promise<string> {
  const { clip, settings } = o;
  const dur = clip.end - clip.start;
  mkdirSync(o.outDir, { recursive: true });
  const out = join(o.outDir, `${slug(clip.title)}-${clip.id.slice(0, 8)}.mp4`);
  const tmp = mkdtempSync(join(tmpdir(), 'vc-export-'));
  try {
    const args = ['-y', '-ss', String(clip.start), '-t', String(dur), '-i', o.videoPath];
    let graph = `${BASE[settings.framing]}[vout]`;

    const clipWords = o.words.filter((w) => w.end > clip.start && w.start < clip.end);
    const segs = settings.captions ? buildCaptionSegments(clipWords, clip.start, settings.captionStyle) : [];
    if (segs.length) {
      writeFileSync(join(tmp, 'blank.png'), blankPng());
      const lines: string[] = [];
      let cursor = 0;
      segs.forEach((s, i) => {
        const start = Math.min(Math.max(s.start, cursor), dur);
        const end = Math.min(Math.max(s.end, start + 0.04), dur);
        if (start >= dur) return;
        if (start > cursor) lines.push(`file 'blank.png'`, `duration ${(start - cursor).toFixed(3)}`);
        writeFileSync(join(tmp, `s${i}.png`), renderSegmentPng(s, settings.captionStyle));
        lines.push(`file 's${i}.png'`, `duration ${(end - start).toFixed(3)}`);
        cursor = end;
      });
      lines.push(`file 'blank.png'`, `duration ${Math.max(dur - cursor, 0.1).toFixed(3)}`, `file 'blank.png'`);
      writeFileSync(join(tmp, 'list.txt'), lines.join('\n'));
      args.push('-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'));
      graph = `${BASE[settings.framing]}[v0];[1:v]format=rgba[cap];` +
        `[v0][cap]overlay=0:${Math.round(1920 * 0.58)}:eof_action=pass[vout]`;
    }

    args.push(
      '-filter_complex', graph, '-map', '[vout]', '-map', '0:a?',
      '-t', String(dur), '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', out,
    );
    await runProc('ffmpeg', args, undefined, (chunk) => {
      const m = [...chunk.matchAll(/out_time_us=(\d+)/g)].pop();
      if (m) o.onProgress(Math.min(99, Math.round((Number(m[1]) / 1e6 / dur) * 100)));
    });
    o.onProgress(100);
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
