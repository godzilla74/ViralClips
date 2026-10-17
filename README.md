# ViralClips

A local, Opus Clip–style app. Give it a long video; it transcribes it on your machine, an LLM picks the
best short-form moments, you review and trim them, and it exports captioned 9:16 MP4s.
Nothing is uploaded anywhere unless you choose the OpenAI provider (then only transcript text is sent).

Runs on **macOS, Windows and Linux**. (Developed on macOS; Windows/Linux are covered by automated tests in CI
and by the setup script below — please open an issue if something misbehaves on your system.)

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
