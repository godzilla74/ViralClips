import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankPng, buildCaptionSegments, renderSegmentPng } from './captions.js';
import { probe, runProc } from './media.js';
import { buildGraph, planRender, type Kind } from './render.js';
import type { Clip, Layout, Settings, Word } from './types.js';

export interface ExportOpts {
  videoPath: string; clip: Clip; words: Word[]; settings: Settings;
  outDir: string; onProgress: (pct: number) => void;
  /** 'vertical' (default) = 1080x1920; 'wide' = source resolution. */
  kind?: Kind;
  /** Needed for the 'stack' framing. */
  layout?: Layout | null;
  src?: { w: number; h: number };
}

const slug = (s: string) =>
  s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'clip';

export async function exportClip(o: ExportOpts): Promise<string> {
  const { clip, settings } = o;
  const kind = o.kind ?? 'vertical';
  const dur = clip.end - clip.start;
  let src = o.src;
  if (!src) { const i = await probe(o.videoPath); src = { w: i.width, h: i.height }; }
  const plan = planRender(kind, settings, o.layout ?? null, src); // throws before anything is written
  mkdirSync(o.outDir, { recursive: true });
  const out = join(o.outDir, `${slug(clip.title)}-${clip.id.slice(0, 8)}-${kind}.mp4`);
  const part = `${out}.part`; // written here, renamed on success so partial files are never listed/downloaded
  const tmp = mkdtempSync(join(tmpdir(), 'vc-export-'));
  try {
    const args = ['-y', '-ss', String(clip.start), '-t', String(dur), '-i', o.videoPath];
    let withCaptions = false;

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
      withCaptions = true;
    }
    const graph = buildGraph(plan, withCaptions);

    args.push(
      '-filter_complex', graph, '-map', '[vout]', '-map', '0:a?',
      '-t', String(dur), '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-f', 'mp4', '-progress', 'pipe:1', '-nostats', part,
    );
    await runProc('ffmpeg', args, undefined, (chunk) => {
      const m = [...chunk.matchAll(/out_time_us=(\d+)/g)].pop();
      if (m) o.onProgress(Math.min(99, Math.round((Number(m[1]) / 1e6 / dur) * 100)));
    });
    renameSync(part, out);
    o.onProgress(100);
    return out;
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
