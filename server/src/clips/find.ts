import { completeParsed } from '../llm/json.js';
import type { LlmProvider } from '../llm/types.js';
import type { Settings, Transcript } from '../types.js';
import { postprocess, type Candidate } from './postprocess.js';
import { makeWindows } from './windows.js';

const prompt = (text: string, s: Settings) => `You are an expert short-form video editor (TikTok, Reels, Shorts).
Below is part of a transcript from a long video. Every line starts with an id and its length in seconds, like [L42|9s].
Pick up to 5 moments that would make the best standalone short clips.

A good clip: opens with a strong hook, makes sense without context, tells a story or delivers one clear insight, and has emotion, surprise, humor, controversy or high practical value. Avoid intros, outros, small talk and fragments that start or end mid-thought.

Rules:
- A clip is a run of CONSECUTIVE lines. Give start_line and end_line (the numeric ids, inclusive, e.g. 42 and 47).
- The line lengths in a clip must add up to between ${s.clipMinSec} and ${s.clipMaxSec} seconds (usually 3-7 lines).
- title and reason must describe ONLY what is said in the chosen lines. Do not describe other parts of the transcript.
- title is a punchy hook (max 80 chars). score is 0-100 for viral potential. reason is one sentence.

Respond with ONLY JSON: {"clips":[{"start_line":0,"end_line":0,"title":"","score":0,"reason":""}]}

TRANSCRIPT:
${text}`;

interface Raw { startLine: number; endLine: number; title: string; score: number; reason: string }

function validate(x: unknown): Raw[] {
  const clips = (x as { clips?: unknown })?.clips;
  if (!Array.isArray(clips)) throw new Error('missing clips array');
  return clips.map((c: any) => ({
    startLine: Number(c.start_line), endLine: Number(c.end_line), score: Number(c.score),
    title: String(c.title ?? 'Untitled clip').slice(0, 120), reason: String(c.reason ?? ''),
  }));
}

export async function findClips(
  t: Transcript, p: LlmProvider, s: Settings, onProgress: (pct: number) => void,
): Promise<Candidate[]> {
  if (!t.words.length) throw new Error('No speech detected');
  const windows = makeWindows(t);
  const all: Candidate[] = [];
  let failures = 0;
  let lastError: unknown;
  for (const [i, w] of windows.entries()) {
    try {
      const byId = new Map(w.lines.map((l) => [l.id, l]));
      for (const r of await completeParsed(p, prompt(w.text, s), validate)) {
        const a = byId.get(r.startLine), b = byId.get(r.endLine);
        if (!a || !b || r.startLine > r.endLine) continue; // line ids must come from this window
        all.push({ start: a.start, end: b.end, title: r.title, score: r.score, reason: r.reason });
      }
    } catch (e) {
      failures++; // skip a failing window; keep partial results
      lastError = e;
    }
    onProgress(Math.round(((i + 1) / windows.length) * 100));
  }
  if (failures === windows.length) throw lastError instanceof Error ? lastError : new Error('The AI model failed on every segment');
  return postprocess(all, t, { minSec: s.clipMinSec, maxSec: s.clipMaxSec, count: s.clipCount });
}
