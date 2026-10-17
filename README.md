# ViralClips

A local, Opus Clip–style app. Give it a long video; it transcribes it on your machine, an LLM picks the
best short-form moments, you review and trim them, and it exports captioned 9:16 MP4s.
Nothing is uploaded anywhere unless you choose the OpenAI provider (then only transcript text is sent).

> **Platform:** built and tested on macOS (Apple Silicon). The file/folder pickers and "Show in Finder"
> use macOS APIs; on other systems paste paths instead. Everything else is plain Node + ffmpeg.

## Prerequisites (one time)

```bash
brew install ffmpeg whisper-cpp
mkdir -p data/models && curl -L -o data/models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
ollama pull qwen2.5:14b      # a plain text model; see "Choosing a model" below
```

Node 22+ is required. The app's **Setup** page checks all of this and shows the exact fix for anything missing.

## Run

```bash
npm install
npm run dev                  # API on :4777, UI on http://localhost:5173
# or production-style:
npm run build && npm start   # http://127.0.0.1:4777
```

The server only listens on `127.0.0.1` and rejects requests from other origins/hosts.

## Using it

1. **Projects** → **📁 Choose a video file…** (opens the macOS picker; the file is used in place, nothing is copied).
   Drag-and-drop also works but makes a full copy in `data/uploads/`.
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
answer on hidden thinking and return nothing. Settings flags these. On a 16 GB Mac, stay around ≤14B parameters.

The model never writes timestamps: it cites numbered transcript lines and the app derives the times from the
words, so titles always match the video segment they point at.

OpenAI is optional (API key in Settings). There is no ChatGPT-login OAuth: OpenAI has no public OAuth for third-party apps.

## Data & privacy

Everything lives in `data/` (git-ignored): the SQLite database, settings (including any API key, mode 0600),
the Whisper model, uploads and default exports.

## Development

```bash
npm test          # server + web tests (the server tests need ffmpeg and macOS' osacompile)
```

Design and plan: `docs/superpowers/specs/`, `docs/superpowers/plans/`.
