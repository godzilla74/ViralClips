import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCaptionSegments, CAPTION_H, CAPTION_W, renderSegmentPng } from './captions.js';
import { stackGeometry, type Placement } from './layout.js';
import { runProc } from './media.js';
import type { Clip, Layout, Settings, Word } from './types.js';

export type Kind = 'vertical' | 'wide';

/** Everything that decides what a rendered frame looks like. Export and preview both use it, so they always agree. */
export interface RenderPlan { base: string; outW: number; outH: number; captionY: number; captionW: number | null }

const BASE_VERTICAL: Record<'crop' | 'blur' | 'original', string> = {
  crop: '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1',
  blur:
    '[0:v]split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:6[bg];' +
    '[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1',
  original: '[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1',
};

const floorEven = (n: number) => Math.max(2, 2 * Math.floor(n / 2));
const crop = (p: Placement) => `crop=${p.crop.w}:${p.crop.h}:${p.crop.x}:${p.crop.y},scale=${p.dest.w}:${p.dest.h}`;

function stackBase(screen: Placement | null, face: Placement | null): string {
  if (!screen) return `[0:v]${crop(face!)},setsar=1`; // talking head only: the crop already fills the canvas
  const blurBg = '[bg]';
  const bg = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:6${blurBg}`;
  if (!face) {
    return `[0:v]split=2[a][b];[a]${bg};[b]${crop(screen)}[s];[bg][s]overlay=${screen.dest.x}:${screen.dest.y},setsar=1`;
  }
  return `[0:v]split=3[a][b][c];[a]${bg};[b]${crop(screen)}[s];[c]${crop(face)}[f];` +
    `[bg][s]overlay=${screen.dest.x}:${screen.dest.y}[t];[t][f]overlay=${face.dest.x}:${face.dest.y},setsar=1`;
}

export function planRender(kind: Kind, settings: Settings, layout: Layout | null, src: { w: number; h: number }): RenderPlan {
  if (kind === 'wide') {
    const outW = floorEven(src.w), outH = floorEven(src.h);
    const captionW = floorEven(outW * 0.62);
    const capH = Math.round((captionW * CAPTION_H) / CAPTION_W);
    return { base: `[0:v]scale=${outW}:${outH},setsar=1`, outW, outH, captionW, captionY: Math.round(outH * 0.97 - capH) };
  }
  if (settings.framing === 'stack') {
    const g = layout ? stackGeometry(layout, src, settings.faceStyle) : null;
    if (!g) throw new Error('The vertical layout isn\'t set up for this video yet. Open "Vertical layout" and detect the screen and face first.');
    return { base: stackBase(g.screen, g.face), outW: 1080, outH: 1920, captionY: g.captionY, captionW: null };
  }
  return { base: BASE_VERTICAL[settings.framing], outW: 1080, outH: 1920, captionY: Math.round(1920 * 0.58), captionW: null };
}

/** The ffmpeg filter graph; input 1 (when captions are on) is the caption image stream. */
export function buildGraph(plan: RenderPlan, withCaptions: boolean): string {
  if (!withCaptions) return `${plan.base}[vout]`;
  const scale = plan.captionW ? `,scale=${plan.captionW}:-1` : '';
  return `${plan.base}[v0];[1:v]format=rgba${scale}[cap];[v0][cap]overlay=(W-w)/2:${plan.captionY}:eof_action=pass[vout]`;
}

export interface PreviewOpts {
  videoPath: string; clip: Clip; words: Word[]; settings: Settings; layout: Layout | null;
  src: { w: number; h: number }; kind: Kind; /** seconds into the clip */ t: number;
}

/** One PNG frame exactly as the export would render it (including a caption sample). */
export async function renderPreview(o: PreviewOpts): Promise<Buffer> {
  const plan = planRender(o.kind, o.settings, o.layout, o.src);
  const dur = o.clip.end - o.clip.start;
  const t = Math.min(Math.max(o.t, 0), Math.max(0, dur - 0.05));
  const tmp = mkdtempSync(join(tmpdir(), 'vc-preview-'));
  try {
    const args = ['-y', '-ss', String(o.clip.start + t), '-i', o.videoPath];
    let withCaptions = false;
    if (o.settings.captions) {
      const clipWords = o.words.filter((w) => w.end > o.clip.start && w.start < o.clip.end);
      const segs = buildCaptionSegments(clipWords, o.clip.start, o.settings.captionStyle);
      const seg = segs.find((s) => s.start <= t && t < s.end) ?? segs.find((s) => s.end > t) ?? segs[0];
      if (seg) {
        writeFileSync(join(tmp, 'cap.png'), renderSegmentPng(seg, o.settings.captionStyle));
        args.push('-loop', '1', '-i', join(tmp, 'cap.png'));
        withCaptions = true;
      }
    }
    const out = join(tmp, 'out.png');
    args.push('-filter_complex', buildGraph(plan, withCaptions), '-map', '[vout]', '-frames:v', '1', out);
    await runProc('ffmpeg', args);
    return readFileSync(out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
