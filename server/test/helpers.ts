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
