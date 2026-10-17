# ViralClips v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that transcribes a long video, uses an LLM (Ollama default, OpenAI optional) to find the best short clips, and exports captioned 9:16 MP4s.

**Architecture:** npm-workspaces monorepo. `server/` (Fastify + SQLite + in-process job queue) shells out to ffmpeg/ffprobe/whisper-cli; `web/` (React + Vite) talks to it over REST + SSE. Pure logic (chunking, clip post-processing, ASS generation, JSON parsing) lives in small testable modules separate from process-spawning code.

**Tech Stack:** Node 22, TypeScript, Fastify, `@fastify/multipart`, `@fastify/static`, better-sqlite3, vitest, React 18, Vite, ffmpeg, whisper.cpp (`whisper-cli`), Ollama HTTP API (`http://127.0.0.1:11434`), OpenAI HTTP API.

**Spec:** `docs/superpowers/specs/2026-10-17-viralclips-design.md`

## Global Constraints

- Node 22, TypeScript strict, ESM. Tests with vitest (`npm test` at root runs all workspaces).
- Server port 4777; Vite dev server proxies `/api` to it. Server binds `127.0.0.1` only.
- Defaults: clip length 30–60 s, top 10 clips, output 1080×1920 (9:16), captions on, provider `ollama`.
- Analysis windows: 5–8 min (use 6 min windows, 1 min overlap).
- LLM JSON invalid → retry up to 2 more times, then return partial results.
- OpenAI key stored in `data/config.json` with file mode 0600; never logged, never returned by the API (return `hasKey: boolean`).
- Local video files referenced in place (not copied); uploads go to `data/uploads/`.
- Only transcript text is ever sent to OpenAI, never video/audio.
- Whisper: `whisper-cli` with word timestamps; audio is 16 kHz mono WAV.
- `data/` is gitignored. Commit after every task.

## Review Focus

- Video with no speech / empty transcript → clear "no speech detected" error, not a crash or empty hang.
- Very short video (< min clip length) → one clip covering the whole video, or a clear message.
- Video with no audio stream → error at ingest with a readable message.
- LLM returns clips outside video bounds, overlapping, inverted (end<start) or non-numeric → filtered/clamped, never exported as-is.
- File path with spaces/quotes/unicode in ffmpeg and local-path ingest → works (spawn with arg arrays, never shell strings); ASS text with `{`, `}`, `\` and newlines escaped.

## File Structure

```
package.json            workspaces: server, web
server/src/
  types.ts              shared types
  config.ts             load/save data/config.json
  deps.ts               check ffmpeg/ffprobe/whisper-cli/ollama
  db.ts                 SQLite schema + queries
  media.ts              ffprobe + audio extraction
  transcribe.ts         whisper-cli wrapper + JSON parser
  llm/{types,ollama,openai,json,index}.ts
  clips/{windows,postprocess,find}.ts
  captions.ts           ASS generator
  export.ts             ffmpeg export
  jobs.ts               queue + SSE bus
  app.ts / index.ts     Fastify routes / entry
server/test/*.test.ts
web/src/{main,App,api}.tsx + pages/{Projects,Project,Settings,Setup}.tsx + components/{ClipList,Player,Trimmer,Transcript}.tsx
```

---

### Task 1: Scaffold, config, dependency check

**Files:** Create `package.json`, `server/package.json`, `server/tsconfig.json`, `server/src/{types,config,deps,app,index}.ts`, `server/test/{config,deps}.test.ts`, `README.md`

**Interfaces:**
- Produces: `types.ts` exporting
  `Word {text:string,start:number,end:number}`; `Transcript {language:string,duration:number,words:Word[]}`; `Clip {id:string,projectId:string,start:number,end:number,title:string,score:number,reason:string,selected:boolean}`; `Settings {provider:'ollama'|'openai',ollamaModel:string,openaiModel:string,openaiKey?:string,clipMinSec:number,clipMaxSec:number,clipCount:number,captions:boolean,framing:'crop'|'blur'|'original',captionStyle:'bold'|'clean'|'karaoke'}`.
- Produces: `config.ts`: `loadSettings(dir?:string):Settings`, `saveSettings(s:Partial<Settings>,dir?:string):Settings` (file 0600), `publicSettings(s):Omit<Settings,'openaiKey'>&{hasKey:boolean}`.
- Produces: `deps.ts`: `checkDeps():Promise<{name:string,ok:boolean,hint:string}[]>` for ffmpeg, ffprobe, whisper-cli, whisper model file, ollama.
- Produces: `app.ts`: `buildApp():FastifyInstance` with `GET /api/health`, `GET /api/setup` (deps), `GET/PUT /api/settings` (public view).

- [ ] **Step 1:** Write failing tests: `config.test.ts` — defaults equal spec values (30/60/10, ollama, captions true); `saveSettings` persists, file mode is `0o600`, `publicSettings` has `hasKey:true` and no `openaiKey`. `deps.test.ts` — `checkDeps` entry for a nonexistent binary has `ok:false` and non-empty hint (inject binary names via optional arg).
- [ ] **Step 2:** Run `npm test -w server`; expect FAIL (modules missing).
- [ ] **Step 3:** Scaffold workspaces, install deps, implement the modules above. `whisper-cli` model path: `data/models/ggml-small.en.bin`; hint for missing items is the exact install command (`brew install whisper-cpp`, model download URL command, `brew install ffmpeg`, `ollama serve`).
- [ ] **Step 4:** Run `npm test -w server`; expect PASS. Run `npm run dev -w server` and `curl localhost:4777/api/health` → `{"ok":true}`.
- [ ] **Step 5:** `git add -A && git commit -m "feat: scaffold server, settings, dependency checks"`

### Task 2: Database, projects, ingest

**Files:** Create `server/src/{db,media}.ts`, `server/test/{db,media}.test.ts`; modify `app.ts`.

**Interfaces:**
- Consumes: `Clip`, `Transcript` from Task 1.
- Produces: `db.ts`: `openDb(path:string)`; `createProject(db,{name,videoPath,duration}):Project`; `getProject`, `listProjects`, `saveTranscript(db,id,Transcript)`, `getTranscript(db,id):Transcript|null`, `replaceClips(db,id,Clip[])`, `listClips(db,id):Clip[]`, `updateClip(db,id,Partial<Clip>)`, `setProjectStatus(db,id,status,error?)`. `Project {id,name,videoPath,duration,status:'new'|'transcribing'|'analyzing'|'ready'|'error',error?:string}`.
- Produces: `media.ts`: `probe(path):Promise<{duration:number,hasAudio:boolean,width:number,height:number}>`, `extractAudio(videoPath,outWav):Promise<void>`.
- Routes: `POST /api/projects` (multipart upload OR JSON `{path}`), `GET /api/projects`, `GET /api/projects/:id`, `GET /api/projects/:id/video` (range-capable stream), `DELETE /api/projects/:id`.

- [ ] **Step 1:** Failing tests: db round-trips project/transcript/clips in `:memory:`; `media.test.ts` generates a 3 s test video with `ffmpeg -f lavfi -i testsrc -f lavfi -i sine` into a temp dir whose name contains spaces and a unicode char, asserts `probe` duration ≈3 and `hasAudio` true, `extractAudio` yields a WAV; a video generated without audio → `probe().hasAudio === false`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. All child processes via `spawn` with argument arrays. `POST /api/projects` returns 400 with message "No audio track found" when `hasAudio` is false and 400 when the path doesn't exist.
- [ ] **Step 4:** Run tests; PASS. Manually `curl -X POST -H 'content-type: application/json' -d '{"path":"<test video>"}' localhost:4777/api/projects`.
- [ ] **Step 5:** Commit `feat: sqlite store, project ingest, ffprobe/audio extract`.

### Task 3: Transcriber

**Files:** Create `server/src/transcribe.ts`, `server/test/transcribe.test.ts`, `server/test/fixtures/whisper-sample.json`.

**Interfaces:**
- Consumes: `Transcript`, `Word`.
- Produces: `parseWhisperJson(raw:unknown):Transcript` (merges whisper sub-word tokens into words: tokens starting with a space begin a new word; drops `[_BEG_]`-style special tokens; times in seconds from `offsets` ms); `transcribe(wavPath:string,opts:{modelPath:string,onProgress:(pct:number)=>void}):Promise<Transcript>` running `whisper-cli -m <model> -f <wav> -ojf -of <tmp> -pp` and parsing progress from stderr `progress = N%`.

- [ ] **Step 1:** Failing tests on `parseWhisperJson` using the fixture (hand-written, includes a token split like `" Hel"`,`"lo"`, a special token, punctuation token): asserts merged words `["Hello","world."]` with correct start/end seconds; empty `transcription` → `words:[]`.
- [ ] **Step 2:** Run; FAIL. **Step 3:** Implement. **Step 4:** PASS. 
- [ ] **Step 5:** Commit `feat: whisper.cpp transcriber with word timestamps`.

### Task 4: LLM providers

**Files:** Create `server/src/llm/{types,json,ollama,openai,index}.ts`, `server/test/llm.test.ts`.

**Interfaces:**
- Produces: `LlmProvider {listModels():Promise<string[]>; completeJSON(prompt:string,opts?:{signal?:AbortSignal}):Promise<string>}` (raw text; parsing is separate). `json.ts`: `extractJson<T>(text:string):T` — strips code fences/`<think>` blocks, finds first balanced `{…}` or `[…]`, throws `Error('invalid JSON')` otherwise; `completeParsed<T>(p:LlmProvider,prompt:string,validate:(x:unknown)=>T,retries=2):Promise<T>`. `index.ts`: `makeProvider(settings):LlmProvider`.
- Ollama: `GET /api/tags` for models; `POST /api/chat` with `format:'json'`, `stream:false`, `think:false`, `options:{temperature:0.3,num_ctx:16384}`. OpenAI: `GET /v1/models` (filter `gpt`/`o`), `POST /v1/chat/completions` with `response_format:{type:'json_object'}`.

- [ ] **Step 1:** Failing tests: `extractJson` handles fenced block, leading prose, `<think>…</think>` prefix, nested braces in strings; throws on garbage. `completeParsed` with a fake provider returning garbage twice then valid JSON succeeds (3 calls total); returns/throws after exhausting retries. Ollama `listModels` against a stubbed `fetch` (inject `fetch` via constructor).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: ollama and openai llm providers with json repair`.

### Task 5: Clip finder (pure logic + orchestration)

**Files:** Create `server/src/clips/{windows,postprocess,find}.ts`, `server/test/{windows,postprocess,find}.test.ts`.

**Interfaces:**
- Consumes: `Transcript`, `Settings`, `LlmProvider`, `completeParsed`.
- Produces: `windows.ts`: `makeWindows(t:Transcript,sizeSec=360,overlapSec=60):{start:number,end:number,text:string}[]` where text lines are prefixed with `[mm:ss]` every sentence/≈10 s so the LLM can cite times.
- `postprocess.ts`: `type Candidate {start:number,end:number,title:string,score:number,reason:string}`; `postprocess(c:Candidate[],t:Transcript,o:{minSec:number,maxSec:number,count:number}):Candidate[]` — drops non-finite/inverted; clamps to `[0,duration]`; snaps start to nearest sentence start and end to nearest sentence end (sentence = word ending `.?!`); enforces min/max (trim end to last sentence end ≤ max; drop if < min unless video itself shorter than min, then keep one whole-video clip); merges overlaps >50% keeping higher score; clamps score 0–100; sorts desc; slices `count`.
- `find.ts`: `findClips(t:Transcript,p:LlmProvider,s:Settings,onProgress:(pct:number)=>void):Promise<Candidate[]>` — empty transcript throws `Error('No speech detected')`; per-window prompt asks for up to 5 clips in JSON `{"clips":[{start,end,title,score,reason}]}` (times in seconds) favoring strong hooks, self-contained stories, emotional/surprising/valuable moments, within min–max length; a window whose retries fail is skipped (partial results); then `postprocess`.

- [ ] **Step 1:** Failing tests: `makeWindows` on a synthetic 20-min transcript → windows of ≤360 s overlapping 60 s covering the whole range; `postprocess` cases: inverted dropped; out-of-bounds clamped; 20 s clip dropped with min 30; 90 s trimmed ≤60 at a sentence end; two 80%-overlapping candidates → one (higher score); NaN score dropped; short whole video → one clip; `findClips` with fake provider returns candidates, with a provider that always throws → returns `[]` without throwing, empty transcript → throws "No speech detected".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: clip detection pipeline`.

### Task 6: Jobs, SSE, analyze pipeline routes

**Files:** Create `server/src/jobs.ts`, `server/test/jobs.test.ts`; modify `app.ts`.

**Interfaces:**
- Produces: `jobs.ts`: `JobBus` with `emit(projectId,{stage:'transcribe'|'analyze'|'export',pct:number,message?:string,done?:boolean,error?:string})` and `subscribe(projectId,cb):()=>void`; `runExclusive(projectId, fn)` ensuring one job per project at a time (rejects with `Error('Job already running')`).
- Routes: `POST /api/projects/:id/analyze` (extract audio → transcribe → findClips → `replaceClips` with `selected:true` for top 5; sets project status; errors recorded), `GET /api/projects/:id/events` (SSE), `GET /api/projects/:id/transcript`, `GET /api/projects/:id/clips`, `PATCH /api/clips/:id` (`start`,`end`,`title`,`selected`; validates `0≤start<end≤duration`), `GET /api/llm/models` (current provider's models; 503 with hint if unreachable).
- Re-analyze reuses saved transcript (skip transcription).

- [ ] **Step 1:** Failing tests: bus delivers events to subscribers and unsubscribes; `runExclusive` second concurrent call rejects; route test using `app.inject` with injected fake transcriber/provider (`buildApp({transcribe, provider})` deps override) → after `POST analyze`, `GET clips` returns clips and project status `ready`; `PATCH` with `start>=end` → 400.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: analyze pipeline, SSE progress, clip editing API`.

### Task 7: Captions and exporter

**Files:** Create `server/src/{captions,export}.ts`, `server/test/{captions,export}.test.ts`; modify `app.ts`.

**Interfaces:**
- Produces: `captions.ts`: `buildAss(words:Word[],clipStart:number,style:Settings['captionStyle']):string` — words shifted to clip-relative time, grouped into lines of ≤4 words / ≤2.5 s, `karaoke` style highlights current word via `\k` tags, PlayRes 1080×1920, font size ~84 bold white w/ black outline, bottom-third margin; text escaped (`{`,`}`→ parenthesis-safe, `\`→`\\`, newlines→space). `export.ts`: `exportClip(o:{videoPath,clip:Clip,words:Word[],settings:Settings,outDir:string,onProgress:(pct)=>void}):Promise<string>` returns output path `<outDir>/<slug>-<id>.mp4`. Filters: `crop` → `scale=-2:1920,crop=1080:1920`; `blur` → split, blurred scaled-to-fill background + centered fit foreground via `overlay`; `original` → `scale=1080:-2` letterboxed on 1080×1920 pad; captions via `subtitles=<ass>` (path escaped for the filtergraph); encode `libx264 -crf 20 -preset veryfast -pix_fmt yuv420p -c:a aac -movflags +faststart`; progress from `-progress pipe:1`.
- Routes: `POST /api/projects/:id/export` body `{clipIds?:string[]}` (default: selected clips) runs sequentially, emits SSE `export` events; `GET /api/exports/:file` download; `GET /api/projects/:id/exports` list.

- [ ] **Step 1:** Failing tests: `buildAss` — header has `PlayResX: 1080`/`PlayResY: 1920`; first dialogue starts at `0:00:00.00` for the clip's first word; text `a{b}\c` is escaped and contains no raw `{b}`; lines ≤4 words. `export.test.ts` — on a generated 10 s 1920×1080 test video in a spaced+unicode path: for each framing mode, exported file probes as 1080×1920 with duration within 0.3 s of clip length (captions on, with sample words).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: captioned 9:16 exporter`.

### Task 8: Web shell, settings, setup checklist, project list

**Files:** Create `web/package.json`, `web/vite.config.ts`, `web/index.html`, `web/src/{main,App,api}.tsx`, `web/src/pages/{Projects,Settings,Setup}.tsx`, `web/src/api.test.ts`.

**Interfaces:**
- Consumes: Task 1–2 routes. Produces: `api.ts` typed client (`getSetup`, `getSettings`, `putSettings`, `listProjects`, `createProjectFromFile(File)`, `createProjectFromPath(string)`, `listModels`, plus ones used in Task 9: `getClips`, `patchClip`, `analyze`, `exportClips`, `subscribeEvents(id,cb)`).
- UI: header nav (Projects / Settings); Projects page with drag-and-drop upload area plus a "or paste a local file path" input, project cards with status; Settings page (provider radio, Ollama model dropdown from `/api/llm/models`, OpenAI key + model, clip min/max, count, captions toggle, framing, caption style); Setup page auto-shown (banner linking to it) when any dep `ok:false`, displaying each hint with copy button.

- [ ] **Step 1:** Failing test (vitest, jsdom): `api.ts` `putSettings` sends JSON and never includes an `openaiKey` field unless the user typed one.
- [ ] **Step 2:** FAIL. **Step 3:** Implement UI; clean, dark theme, responsive. **Step 4:** PASS; `npm run dev` and verify in the browser: upload via path creates a project card; settings persist after reload; Setup page lists whisper-cli as missing with install hint.
- [ ] **Step 5:** Commit `feat: web shell, settings, setup checklist, projects`.

### Task 9: Project page — review, trim, export

**Files:** Create `web/src/pages/Project.tsx`, `web/src/components/{Player,ClipList,Trimmer,Transcript}.tsx`, `web/src/components/trim.test.ts`.

**Interfaces:**
- Consumes: Task 6–7 routes via `api.ts`.
- Produces: `trim.ts`: `clampTrim(start:number,end:number,duration:number,minSec=5):{start:number,end:number}` used by Trimmer drag handlers.
- UI: "Find best clips" button (disabled while running) with live progress bar from SSE; player (`<video src=/api/projects/:id/video>`) that plays only the active clip range and loops it; clip list sorted by score with score badge, title (editable), reason, include checkbox, click to preview; Trimmer with two drag handles over a mini timeline + numeric inputs (changes PATCH debounced); transcript pane highlighting words in the active clip and click-to-seek; Export panel (framing, captions, style, "Export N clips") showing per-clip progress and download links.

- [ ] **Step 1:** Failing tests: `clampTrim` keeps within `[0,duration]`, enforces `end-start ≥ minSec`, swaps nothing when valid, handles `start>end` input by clamping.
- [ ] **Step 2:** FAIL. **Step 3:** Implement components. **Step 4:** PASS; run app with the real pipeline on a short real video (Ollama + `qwen2.5:14b`), verify in the browser: analyze → clips appear → trim → export → downloaded MP4 plays at 1080×1920 with captions.
- [ ] **Step 5:** Commit `feat: clip review, trim and export UI`.

### Task 10: Production serve, integration test, README

**Files:** Modify `server/src/app.ts` (serve `web/dist` via `@fastify/static`), root `package.json` (`build`, `start`, `dev` scripts using concurrently); Create `server/test/pipeline.integration.test.ts`, `README.md`.

- [ ] **Step 1:** Failing integration test: with stub transcriber (words for a 20 s generated video) and stub provider returning two clips, run `POST analyze` → `PATCH` one clip → `POST export` via `app.inject`; assert exported file exists, probes 1080×1920, and only selected clips were exported; also a no-speech stub transcript → project status `error` with message "No speech detected".
- [ ] **Step 2:** FAIL. **Step 3:** Implement static serving and scripts; README documents prerequisites (`brew install ffmpeg whisper-cpp`, model download, `ollama pull`), `npm run dev`, `npm start`. **Step 4:** `npm test` all green; `npm run build && npm start` and open `http://127.0.0.1:4777`.
- [ ] **Step 5:** Commit `feat: production serve, integration test, docs`.

---

## Self-Review

- Spec coverage: ingest (T2), transcriber (T3), clip finder + heuristics (T5; heuristic blending is limited to the prompt criteria plus postprocess length/overlap rules — a numeric density signal is deliberately omitted per YAGNI), providers (T4), jobs/SSE (T6), exporter + captions (T7), UI incl. settings/setup (T8–9), error handling (T1, T5, T6), testing (all + T10).
- Names consistent across tasks: `Candidate` (T5) → `Clip` via `replaceClips` (T6); `Settings` fields used identically in T1, T5, T7, T8.
