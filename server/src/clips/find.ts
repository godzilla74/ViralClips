import { completeParsed } from '../llm/json.js';
import type { LlmProvider } from '../llm/types.js';
import type { Settings, Transcript } from '../types.js';
import { postprocess, type Candidate } from './postprocess.js';
import { makeWindows } from './windows.js';

const prompt = (text: string, s: Settings) => `You are an expert short-form video editor (TikTok, Reels, Shorts).
Below is a timestamped transcript segment from a long video. Pick up to 5 moments that would make the best standalone short clips.

Good clips: open with a strong hook, are self-contained (make sense without context), tell a story or deliver one clear insight, and carry emotion, surprise, humor, controversy or high practical value. Avoid intros, outros, small talk and mid-thought fragments.

Rules:
- Each clip must be between ${s.clipMinSec} and ${s.clipMaxSec} seconds long.
- start and end are absolute seconds in the video, derived from the [mm:ss] markers.
- score is 0-100 for viral potential. title is a punchy hook (max 80 chars). reason is one sentence.

Respond with ONLY JSON: {"clips":[{"start":0,"end":0,"title":"","score":0,"reason":""}]}

TRANSCRIPT:
${text}`;

function validate(x: unknown): Candidate[] {
  const clips = (x as { clips?: unknown })?.clips;
  if (!Array.isArray(clips)) throw new Error('missing clips array');
  return clips.map((c: any) => ({
    start: Number(c.start), end: Number(c.end), score: Number(c.score),
    title: String(c.title ?? 'Untitled clip').slice(0, 120), reason: String(c.reason ?? ''),
  }));
}

export async function findClips(
  t: Transcript, p: LlmProvider, s: Settings, onProgress: (pct: number) => void,
): Promise<Candidate[]> {
  if (!t.words.length) throw new Error('No speech detected');
  const windows = makeWindows(t);
  const all: Candidate[] = [];
  for (const [i, w] of windows.entries()) {
    try {
      all.push(...(await completeParsed(p, prompt(w.text, s), validate)));
    } catch {
      // skip a failing window; keep partial results
    }
    onProgress(Math.round(((i + 1) / windows.length) * 100));
  }
  return postprocess(all, t, { minSec: s.clipMinSec, maxSec: s.clipMaxSec, count: s.clipCount });
}
