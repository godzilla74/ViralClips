# ViralClips — Design Spec

**Date:** 2026-10-17
**Status:** Awaiting approval

## Goal

A local web app (Opus Clip–style). The user provides a long-form video; the app transcribes it locally, uses an LLM to find the most clip-worthy segments, lets the user review/trim them, and exports vertical 9:16 short-form MP4s with optional burned-in captions. Runs entirely on the user's Mac.

## Success criteria

- Drop in (or point at) a video → one click → ranked list of suggested clips with score + reason.
- Preview, trim, select clips; export 1080×1920 MP4s with word-by-word captions.
- Works fully offline/free with Ollama; OpenAI (API key) optional.
- Setup problems (missing ffmpeg/whisper/Ollama) are surfaced with clear fix hints.

## Non-goals (v1)

Face tracking / auto-reframe, ChatGPT OAuth (OpenAI has no public third-party OAuth; deferred behind the provider interface), social posting, accounts/cloud, speaker diarization.

## Stack

Node 22 + TypeScript monorepo. `server/` Fastify; `web/` React + Vite. SQLite (`node:sqlite`/better-sqlite3) for projects, transcripts, clips, jobs. External binaries: `ffmpeg`/`ffprobe` (present), `whisper-cpp` (`brew install whisper-cpp`; model auto-downloaded, default `ggml-base.en`/`small`). Data in gitignored `data/`.

## Architecture / components

1. **Ingest** — create project from upload or local file path (referenced in place to avoid copying GB files); `ffprobe` metadata; extract 16 kHz mono WAV.
2. **Transcriber** — wraps `whisper-cli` with word-level timestamps (JSON output); reports progress.
3. **Clip finder** — split transcript into overlapping 5–8 min windows → LLM proposes candidates `{start,end,title,score,reason}` as strict JSON (retry ×2 on invalid JSON) → merge/dedupe overlaps → snap boundaries to sentence edges → clamp to target length (default 30–60 s, configurable) → rank, keep top N. Light heuristic signals (hook strength, speech density) blended into score.
4. **LLM provider interface** — `listModels()`, `completeJSON(prompt, schema)`. Implementations: **Ollama** (default; lists installed models, user picks) and **OpenAI** (API key in `data/config.json`, mode 0600).
5. **Jobs** — in-process queue; progress streamed to UI via SSE. Stages: ingest, transcribe, analyze, export.
6. **Exporter** — ffmpeg cut → 1080×1920 with framing modes (center-crop, blurred-background fit, original) → optional ASS burned-in word-highlight captions (few style presets). Output in `data/exports/`, downloadable from UI.
7. **Web UI** — Projects list; project page with player, ranked clip list (score, reason), transcript with highlighting, draggable trim handles, include checkboxes, export panel; Settings (provider, model, API key, clip length, count); setup checklist screen.

## Error handling

Missing binaries → setup checklist. Ollama down → banner with hint. Bad LLM JSON → retry, then show partial results. Job failures recorded with log tail, retryable from UI.

## Testing

Unit: window chunking, merge/dedupe/snap/clamp, JSON parsing/repair, ASS generator, config handling. Integration: full pipeline with stub LLM + stub transcript on a short generated test video (ffmpeg `testsrc`), asserting export dimensions/duration.

## Layout

```
ViralClips/
  server/  web/  data/(gitignored)  docs/superpowers/{specs,plans}
  package.json (workspaces)  README.md
```

## Defaults

30–60 s clips, 9:16, captions on, top 10 clips, Ollama provider.
