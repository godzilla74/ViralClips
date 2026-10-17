# ViralClips

A local, Opus Clip–style app. Give it a long video; it transcribes it on your machine, an LLM picks the
best short-form moments, you review and trim them, and it exports captioned 9:16 MP4s.
Nothing is uploaded anywhere unless you choose the OpenAI provider (then only transcript text is sent).

Runs on **macOS, Windows and Linux**. (Developed on macOS; Windows/Linux are covered by automated tests in CI
and by the setup script below — please open an issue if something misbehaves on your system.)

## What you get

- Drop in an hour-long video → a ranked list of the most shareable 30–60 second moments, each with a title,
  a one-line reason, a quote of what is actually said, and a score.
- Preview each clip, trim it with draggable handles, rename it, pick the ones you want.
- Export vertical 1080×1920 MP4s with word-by-word captions (three caption styles, three framing options)
  to any folder you choose.
- Free and private: transcription (whisper.cpp) and clip-finding (Ollama) run on your own machine.

**Requirements:** Node.js 22+; about 1 GB of disk for the app and the speech model, plus 2–9 GB for a text model
(a 14B model is ~9 GB); at least 8 GB of RAM (16 GB recommended for a 14B model — the setup script picks a model
that fits your RAM).

## Quick start

You need **Node.js 22+** ([nodejs.org](https://nodejs.org); Windows: `winget install OpenJS.NodeJS.LTS`,
macOS: `brew install node@22`) and **git**. Then:

```bash
git clone <this repo> ViralClips
cd ViralClips
node scripts/setup.mjs      # checks everything and offers to install what's missing
npm run dev                 # then open http://localhost:5173
```

`node scripts/setup.mjs` (also `npm run setup` once packages are installed) is safe to re-run. It asks before each step:

| Needs | macOS | Windows | Linux |
|---|---|---|---|
| npm packages | `npm install` | `npm install` | `npm install` |
| ffmpeg | `brew install ffmpeg` | `winget install Gyan.FFmpeg` | `apt` / `dnf` / `pacman` (asks for sudo) |
| whisper.cpp | `brew install whisper-cpp` | downloads the official release into `data/bin` | `brew`, or builds from source into `data/bin` (needs git + cmake + a C++ compiler) |
| Speech model | downloads ~470 MB to `data/models` | same | same |
| Ollama + a text model | offers `brew install --cask ollama`, then pulls a model sized to your RAM | offers `winget install Ollama.Ollama` | prints the install link |

Options: `--check` (report only, change nothing), `--yes` (don't ask). `npm run doctor` = `--check`.
After installing ffmpeg with winget, **open a new terminal** so it's on your PATH, then run setup again.
If you keep whisper.cpp somewhere else, set `VC_WHISPER` to the full path of `whisper-cli`.

Prefer to do it by hand? You need: `ffmpeg` + `ffprobe` on your PATH, `whisper-cli` (whisper.cpp),
the model file `data/models/ggml-small.en.bin`
([download](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin)), and either Ollama with a
text model (`ollama pull qwen2.5:14b`) or an OpenAI API key. The app's **Setup** page shows what's missing.

## Run

```bash
npm run dev                  # API on :4777, UI on http://localhost:5173
# or production-style:
npm run build && npm start   # http://127.0.0.1:4777
```

The server only listens on `127.0.0.1` and rejects requests from other origins/hosts.

## Using it

1. **Projects** → **📁 Choose a video file…** (your system's file picker; the file is used in place, nothing is copied).
   On Linux this needs `zenity` or `kdialog`; otherwise paste the path. Drag-and-drop also works but makes a full copy in `data/uploads/`.
2. **Find best clips** → transcribe + AI analysis with live progress.
3. Review ranked clips. Each shows the AI's title and reason, plus a snippet of what is actually said;
   the transcript pane marks where the clip starts and ends.
4. Trim with the handles, rename, tick the clips to export.
5. **Export** → 1080×1920 MP4s (center-crop, blurred-background or bars; word-highlight, bold or clean captions).
   Choose **where to save** with the folder picker; default is `data/exports/`. Deleting a project never deletes
   files you exported to your own folder.

## Choosing a model

Clip-finding sends the transcript as text, so use a **plain text model** (e.g. `qwen2.5:14b`, `llama3.1:8b`,
`gemma3:12b`, `mistral-nemo`, `phi4`). Avoid "reasoning/thinking" and vision models: they can spend their whole
answer on hidden thinking and return nothing. Settings flags these. As a rule of thumb, keep the model under about
70% of your RAM (≈ ≤14B parameters on a 16 GB machine).

The model never writes timestamps: it cites numbered transcript lines and the app derives the times from the
words, so titles always match the video segment they point at.

OpenAI is optional (API key in Settings). There is no ChatGPT-login OAuth: OpenAI has no public OAuth for third-party apps.

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"…is a reasoning model and returned no answer"** or "Invalid JSON" | You picked a reasoning/thinking or vision model (the Settings dropdown marks them ⚠). Pick a plain text model such as `qwen2.5:14b`, `llama3.1:8b` or `gemma3:12b`. |
| **"Cannot reach Ollama"** | Open the Ollama app, or run `ollama serve`. Check with `ollama list`. |
| **Setup page says ffmpeg / whisper-cli is missing** | Run `npm run setup`. On Windows, open a **new terminal** after installing ffmpeg so it is on your PATH. If whisper.cpp lives somewhere custom, set `VC_WHISPER` to the full path of `whisper-cli`. |
| **"No speech detected"** | The audio is silent, or not English (see Limitations). |
| **"No suitable clips found"** | The model returned nothing usable. Try another model, or lower the minimum clip length in Settings. Your previous clips are kept. |
| **The file picker does nothing (Linux)** | Install `zenity` (or `kdialog`), or paste the file path instead. |
| **Analysis is very slow** | Use a smaller model, and close other heavy apps. A model larger than ~70% of your RAM spills to the CPU and crawls. |
| **Port already in use** | Another copy is running. Stop it, or start the production server with `PORT=4790 npm start`. (`npm run dev` always uses 4777 for the API.) |
| **Exports look wrong or fail** | Check `ffmpeg -version` works in a terminal. The error shown in the app includes ffmpeg's last output lines. |

Run `npm run doctor` any time for a checklist of what's installed.

## How it works

```
video ──ffmpeg──▶ 16 kHz audio ──whisper.cpp──▶ word-level transcript
                                                    │
                  numbered lines  [L42|9s] …  ◀─────┘  (overlapping ~6 min windows)
                        │
                 Ollama / OpenAI picks line ranges + title + reason
                        │
   line ids → exact start/end times from the words → snap to sentence ends, enforce min/max
   length, merge overlaps, rank          ← the model never writes timestamps
                        │
            you review / trim ──ffmpeg──▶ 1080×1920 MP4 + burned-in captions
```

Typical speed on a 16 GB Apple-silicon Mac: transcription runs far faster than real time (about 10 s for a
100 s clip); clip-finding with a 12B model took about 4–5 minutes for a 27-minute video. Your hardware will vary.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Provider, model, API key, clip length, count, framing, caption style, export folder | **Settings** page (saved in `data/config.json`) | Ollama, `qwen2.5:14b`, 30–60 s, 10 clips, center crop, word highlight |
| `VC_DATA` | env var | `./data` — where the database, models, uploads and exports live |
| `VC_WHISPER` | env var | auto: `data/bin`, then your `PATH` |
| `PORT` | env var | `4777` |

## Limitations

- **English only** for now: the bundled speech model is `ggml-small.en`.
- Framing is a center crop (or blurred/bars) — no face tracking or auto-reframe yet.
- No direct posting to TikTok / Instagram / YouTube yet; you export files and upload them yourself.
- Clip quality depends on the model. A 12–14B local model is decent, not perfect — the quote under each clip title
  lets you verify what it picked. OpenAI models are better but send the transcript text to OpenAI.
- Developed on macOS. Windows/Linux are covered by CI and the setup script but have had less real-world use.

## Project layout

```
server/   Fastify API, SQLite, job queue, ffmpeg/whisper/LLM integration (TypeScript)
  src/clips/    windows (numbered lines), LLM clip finder, post-processing
  src/llm/      Ollama and OpenAI providers
  test/         vitest suites (many shell out to ffmpeg)
web/      React + Vite UI
scripts/  setup.mjs — cross-platform dependency checker/installer
data/     your database, models, uploads, exports (git-ignored)
docs/     design spec and implementation plan
```

## Data & privacy

Everything lives in `data/` (git-ignored): the SQLite database, settings (including any API key; owner-only
permissions on macOS/Linux), the Whisper model, tools installed by setup (`data/bin`), uploads and default exports.

## Development

```bash
npm test          # server + web tests; needs ffmpeg on PATH (whisper and Ollama are stubbed)
```

CI (`.github/workflows/ci.yml`) runs the tests and build on macOS, Windows and Linux.
Design and plan: `docs/superpowers/specs/`, `docs/superpowers/plans/`.

Caption font: [Montserrat](https://fonts.google.com/specimen/Montserrat) (SIL Open Font License), bundled via npm.

## License

[MIT](LICENSE) © 2026 Justin Farmer
