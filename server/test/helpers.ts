import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Generates a test video in a dir whose name has spaces and a unicode char. */
export function makeVideo(opts: { seconds?: number; audio?: boolean; w?: number; h?: number } = {}) {
  const { seconds = 3, audio = true, w = 1920, h = 1080 } = opts;
  const dir = join(mkdtempSync(join(tmpdir(), 'vc test é-')), 'my clips');
  mkdirSync(dir);
  const out = join(dir, "vid 'x'.mp4");
  const args = ['-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=24:duration=${seconds}`];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`);
  args.push('-pix_fmt', 'yuv420p', '-shortest', out);
  execFileSync('ffmpeg', args, { stdio: 'ignore' });
  return { path: out, dir };
}

/** 640x360 composite: static black background, two noisy rectangles ("screen" and "webcam"). */
export function makeComposite(seconds = 4) {
  const dir = join(mkdtempSync(join(tmpdir(), 'vc composite é-')), 'rec');
  mkdirSync(dir);
  const out = join(dir, 'composite.mp4');
  const noise = (w: number, h: number) => `nullsrc=s=${w}x${h}:r=12:d=${seconds},format=gray,geq=lum='random(1)*255',format=yuv420p`;
  execFileSync('ffmpeg', ['-y',
    '-f', 'lavfi', '-i', `color=c=black:s=640x360:r=12:d=${seconds}`,
    '-f', 'lavfi', '-i', noise(300, 200),
    '-f', 'lavfi', '-i', noise(140, 200),
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-filter_complex', '[0:v][1:v]overlay=20:60[t];[t][2:v]overlay=480:60[v]',
    '-map', '[v]', '-map', '3:a', '-pix_fmt', 'yuv420p', '-shortest', out], { stdio: 'ignore' });
  return { path: out, dir, screen: { x: 20 / 640, y: 60 / 360, w: 300 / 640, h: 200 / 360 }, webcam: { x: 480 / 640, y: 60 / 360, w: 140 / 640, h: 200 / 360 } };
}
